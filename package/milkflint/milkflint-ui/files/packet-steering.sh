#!/bin/sh
# MilkFlint's packet steering for the GL-MT6000, run by /etc/init.d/packet_steering
# in place of OpenWrt's packet-steering.uc. $1 is network.globals.packet_steering:
# 0 turns steering off; anything else (or unset) uses the layout below.
#
# OpenWrt's layout puts the mtk_eth NAPI on CPU0 and steers every packet the
# Ethernet ports receive to one other CPU (CPU2). That CPU then does all the
# forwarding, NAT and both Smart Queue (cake) directions, and under a fast
# download it runs out while the other three idle, which limits the speed
# and adds latency. It also pins all six mt76 NAPI threads and mt76-tx to
# one CPU (CPU3).
#
# Here the Ethernet NAPI stays on CPU0 (its interrupts land there too) and
# received packets are spread by flow over CPUs 1-3, which the Wi-Fi threads
# also share, so no one CPU runs out. CPU0 is left out of RPS: with all
# four CPUs it would run out (NAPI plus its share of flows).
# Wi-Fi netdevs get no RPS: mt76's threaded NAPI already does their RX.
#
# With RSS (an image whose Ethernet has four RX rings),
# the hardware spreads flows instead of RPS: the RSS table puts them on
# rings 1-3, ring N's interrupt and NAPI thread run on CPU N, and nothing is
# steered on, so a flow stays on its ring's CPU. With cake_mq (Smart Queue's
# Multi-queue) ring N also feeds sub-queue N. Ring 0 gets no flows: CPU0
# keeps the TX NAPI and its interrupts, which with ring 0 too would leave it
# nearly full. Rate and latency as with RPS, with less CPU in all.
# With RSS the Wi-Fi threads may run on any CPU, CPU0 included, and the
# rings' NAPI threads run SCHED_FIFO, as mt76-tx does: a ring's thread that
# wakes runs at once instead of waiting behind a Wi-Fi thread on its CPU,
# and the Wi-Fi threads move to whichever CPU is free. Both cut the time
# packets wait for a CPU under load, for a little more CPU.
# milkflint.steering.wifi_all=0 keeps the Wi-Fi threads on CPUs 1-3, and
# milkflint.steering.rings_rt=0 the rings' threads at normal priority (the
# Performance Tuning page's switches).
# The MT7986 hashes either the switch's tagged packets or the untagged
# MAC's, not both (the CDMP special tag, mtk_eth_soc 990-06), and the image
# hashes eth1's, the WAN. Everything the LAN ports receive (eth0) lands on
# ring 0 unhashed, on CPU0. milkflint.steering.lan_rps=1 (the page's
# experimental switch) keeps the RPS hand-off to CPUs 1-3 on the switch
# port's ring 0 with RSS too, so a wired upload, or a wired device sending
# to Wi-Fi, is spread as before RSS instead of all handled on CPU0. Unset,
# nothing is handed on with RSS.
# milkflint.steering.rss=0 keeps every flow on ring 0 with the RPS layout
# above. Without the rings (an older image), that layout is all there is.
#
# A PPPoE internet connection spreads nothing with RSS: the hash can't read
# inside PPPoE, so its downloads all arrive on its port's ring 0, as what
# the switch receives does anyway (the switch's tag keeps it from the hash).
# Unset (Automatic on the page) is RSS, but the RPS layout when any
# interface is PPPoE; milkflint.steering.rss=1 is RSS whatever the line,
# and then the PPPoE port's ring 0 alone gets RPS. Either way sqm-scripts
# gives the PPP device's download ifb a sub-queue per CPU (its patch 109),
# and an Ethernet port's when RPS spreads it (110: the RPS layout,
# OpenWrt's).
#
# milkflint.steering.layout=openwrt (the Performance Tuning page) hands it
# all to OpenWrt's packet-steering.uc instead, with the arguments
# /etc/init.d/packet_steering gives that when there's no platform script, so
# LuCI's "Enabled (all CPUs)" and steering flows work as in OpenWrt. It and
# "off" put every flow back on ring 0.

NAPI_CPUS=1
# every CPU but CPU0: e on the MT7986's four (a mask with CPUs the kernel
# doesn't have is refused, as in a 2-CPU VM)
ncpu=$(grep -c ^processor /proc/cpuinfo)
WORK_CPUS=$(printf %x $((((1 << ncpu) - 1) & ~1)))
# the RSS table is the frame engine's, shared by its two MACs; it's set on
# the one that isn't the switch's (eth1 on the GL-MT6000, wan on the EX5601)
RSS_DEV=$(/usr/libexec/milkflint/ports rss 2> /dev/null)
[ -n "$RSS_DEV" ] || RSS_DEV=eth1

# the frame engine's interrupt for GIC SPI number $1 (pdma0-3: 221-224)
eth_irq() {
	awk -v h="$1" '/15100000.ethernet/ && $(NF-2) == h { sub(":", "", $1); print $1 }' /proc/interrupts
}

# the frame engine's NAPI threads in NAPI id order: TX's first, then rings 0-3
eth_napi_pids() {
	for p in /proc/[0-9]*; do
		c=$(cat "$p/comm" 2> /dev/null)
		case "$c" in napi/mtk_eth-*) echo "${c#napi/mtk_eth-} ${p#/proc/}" ;; esac
	done | sort -n | awk '{ print $2 }'
}

# the NAPI threads of rings 1-3, the ones the RSS table uses, at SCHED_FIFO
# $1 (1-99), or back to SCHED_OTHER with "other". TX's and ring 0's stay
# SCHED_OTHER.
RTPRIO=/usr/libexec/milkflint/rtprio
ring_policy() {
	[ -x $RTPRIO ] || return 0
	for pid in $(eth_napi_pids | tail -n +3); do
		if [ "$1" = other ]; then
			$RTPRIO "$pid" other > /dev/null
		else
			$RTPRIO "$pid" fifo "$1" > /dev/null
		fi
	done
}

has_rss() {
	command -v ethtool > /dev/null &&
		ethtool -x $RSS_DEV 2> /dev/null | grep -q 'with 4 RX ring' &&
		[ -n "$(eth_irq 224)" ] &&
		[ "$(eth_napi_pids | wc -l)" -eq 5 ]
}

# every flow on ring 0 and the rings' interrupts on any CPU, as before RSS
rss_off() {
	command -v ethtool > /dev/null && ethtool -X $RSS_DEV equal 1 > /dev/null 2>&1
	for n in 0 1 2 3; do
		i=$(eth_irq $((221 + n)))
		[ -n "$i" ] && echo f > /proc/irq/$i/smp_affinity
	done
}

# whether RPS spreads what device $1 receives over the CPUs: its first
# receive queue's mask isn't empty, or, for a device on top of one other (a
# VLAN, a DSA port), that one's down to the port: RPS runs where the
# packets come in
rps_spreads() {
	local dev=$1 m lower i=0
	while [ $i -lt 4 ]; do
		m=$(cat "/sys/class/net/$dev/queues/rx-0/rps_cpus" 2> /dev/null)
		case "$m" in '' | *[!0-9a-fA-F,]*) ;; *) [ -n "$(echo "$m" | tr -d '0,')" ] && return 0 ;; esac
		lower=$(ls -d /sys/class/net/$dev/lower_* 2> /dev/null)
		[ -n "$lower" ] && [ "$(echo "$lower" | wc -l)" -eq 1 ] || return 1
		dev=${lower##*/lower_}
		i=$((i + 1))
	done
	return 1
}

# The ifbs sqm-scripts gives a sub-queue per CPU, queue N taking what CPU N
# hands it: a PPP device's (its patch 109) and an Ethernet port's that RPS
# spreads (110). The kernel would pick an ifb's queue by the receive queue a
# packet came in on: right with RSS, each ring's own sub-queue, but a PPPoE
# session's packets, and all of a port's without RSS, come in on its first
# queue, and every CPU RPS hands them to would feed sub-queue 1. It holds
# while each flow stays on one CPU, as RPS and the pinned rings keep it, in
# every layout but off, whose threads move between CPUs: there a flow's
# packets would reach two sub-queues and be reordered, so the kernel's
# choice again. Run once RPS is set, for the ifbs already there: sqm-scripts
# sets new ones the same way.
ifb_queues() {
	local d q per
	for d in /sys/class/net/ifb4*; do
		[ -d "$d/queues/tx-1" ] || continue
		per=
		if [ "$1" = on ]; then
			{ [ "$(cat "/sys/class/net/${d##*/ifb4}/type" 2> /dev/null)" = 512 ] ||
				rps_spreads "${d##*/ifb4}"; } && per=1
		fi
		for q in "$d"/queues/tx-*; do
			if [ -n "$per" ]; then printf '%x\n' $((1 << ${q##*tx-})); else echo 0; fi > "$q/xps_cpus"
		done
	done
}

if [ "$(uci -q get milkflint.steering.layout)" = openwrt ] && [ -x /usr/libexec/network/packet-steering.uc ]; then
	rss_off
	ring_policy other
	flows=$(uci -q get "network.@globals[0].steering_flows")
	if [ "${flows:-0}" -gt 0 ] 2> /dev/null; then
		/usr/libexec/network/packet-steering.uc -l "$flows" "$1"
	else
		/usr/libexec/network/packet-steering.uc "$1"
	fi
	ret=$?
	# after its RPS, which decides the ifbs' queues
	if [ "$1" = 0 ]; then ifb_queues off; else ifb_queues on; fi
	exit $ret
fi

[ "$1" = 0 ] && off=1

# The ports under the PPPoE interfaces (wan, or any other), through VLAN
# devices whatever their names: RSS spreads nothing a session receives
port_of() {
	local dev=$1 lower i=0
	while [ $i -lt 4 ]; do
		lower=$(ls -d /sys/class/net/$dev/lower_* 2> /dev/null)
		[ -n "$lower" ] && [ "$(echo "$lower" | wc -l)" -eq 1 ] || break
		dev=${lower##*/lower_}
		i=$((i + 1))
	done
	# a VLAN netifd hasn't made yet: its name's part before the ".N"
	[ -d "/sys/class/net/$dev" ] || dev=${dev%%.*}
	echo "$dev"
}
pppoe_ports=
for i in $(uci -q show network | sed -n "s/^network\.\([^.]*\)\.proto='pppoe'$/\1/p"); do
	d=$(uci -q get "network.$i.device")
	[ -n "$d" ] && pppoe_ports="$pppoe_ports $(port_of "$d")"
done

# RSS: "1" whatever the line, "0" never (the RPS layout), unset unless the
# internet connection is PPPoE
case "$(uci -q get milkflint.steering.rss)" in
1) want_rss=1 ;;
0) want_rss= ;;
*) [ -z "$pppoe_ports" ] && want_rss=1 || want_rss= ;;
esac

if [ -z "$off" ] && [ -n "$want_rss" ] && has_rss &&
	ethtool -X $RSS_DEV weight 0 1 1 1 > /dev/null 2>&1; then
	rss=1
	for n in 0 1 2 3; do
		i=$(eth_irq $((221 + n)))
		[ -n "$i" ] && printf %x $((1 << n)) > /proc/irq/$i/smp_affinity
	done
	n=-1
	for pid in $(eth_napi_pids); do
		# TX on CPU0, ring N on CPU N
		[ $n -lt 0 ] && m=1 || m=$(printf %x $((1 << n)))
		taskset -p "$m" "$pid" > /dev/null
		n=$((n + 1))
	done
	[ "$(uci -q get milkflint.steering.rings_rt)" = 0 ] && ring_policy other || ring_policy 1
else
	rss_off
	ring_policy other
fi

all=$(printf %x $(((1 << ncpu) - 1)))
# the Wi-Fi threads: every CPU with RSS, unless asked to keep to CPUs 1-3
wifi=$WORK_CPUS
[ -n "$rss" ] && [ "$(uci -q get milkflint.steering.wifi_all)" != 0 ] && wifi=$all

for p in /proc/[0-9]*; do
	case "$(cat "$p/comm" 2> /dev/null)" in
	napi/mtk_eth-*) [ -n "$rss" ] && continue; m=$NAPI_CPUS ;;
	napi/phy*|mt76-tx*) m=$wifi ;;
	*) continue ;;
	esac
	[ -n "$off" ] && m=$all
	taskset -p "$m" "${p#/proc/}" > /dev/null
done

# RPS: the Ethernet's ports in the RPS layout, nothing with RSS, and with
# RSS chosen on a PPPoE line, the PPPoE port's ring 0, where the session's
# packets arrive (the kernel's own flow hash reads PPPoE); rings 1-3 stay as
# RSS has them. Other drivers' ports (a VM's) get it as a PPPoE port only.
# With RSS and lan_rps=1, the switch port's ring 0 too, where everything the
# LAN ports receive lands. Not RSS_DEV's: what Smart Queue's ifb hands back
# to it from its tx queue N comes in as rx queue N-1, so ring 1's downloads
# would be steered again after CAKE.
lan_rps=
[ -n "$rss" ] && [ "$(uci -q get milkflint.steering.lan_rps)" = 1 ] && lan_rps=1
for q in /sys/class/net/*/queues/rx-*/rps_cpus; do
	dev=${q#/sys/class/net/}
	dev=${dev%%/*}
	case "$(basename "$(readlink "/sys/class/net/$dev/device/driver")")" in
	mtk_soc_eth) m=$WORK_CPUS ;;
	*) m=0 ;;
	esac
	if [ -n "$lan_rps" ]; then
		case "$dev/${q#*/queues/}" in "$RSS_DEV"/* | */rx-[1-9]*/*) m=0 ;; esac
	elif [ -n "$rss" ]; then
		m=0
	fi
	[ -n "$off" ] && m=0
	if [ -z "$off" ]; then
		for p in $pppoe_ports; do
			[ "$q" = "/sys/class/net/$p/queues/rx-0/rps_cpus" ] && m=$WORK_CPUS
		done
	fi
	echo "$m" > "$q"
done

if [ -n "$off" ]; then ifb_queues off; else ifb_queues on; fi
