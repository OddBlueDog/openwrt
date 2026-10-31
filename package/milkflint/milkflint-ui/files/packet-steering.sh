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
# milkflint.steering.rss=0 keeps every flow on ring 0 with the RPS layout
# above. Without the rings (an older image), that layout is all there is.
#
# milkflint.steering.layout=openwrt (the Performance Tuning page) hands it
# all to OpenWrt's packet-steering.uc instead, with the arguments
# /etc/init.d/packet_steering gives that when there's no platform script, so
# LuCI's "Enabled (all CPUs)" and steering flows work as in OpenWrt. It and
# "off" put every flow back on ring 0.

NAPI_CPUS=1
WORK_CPUS=e
# the RSS table is the frame engine's, shared by eth0 and eth1
RSS_DEV=eth1

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

if [ "$(uci -q get milkflint.steering.layout)" = openwrt ] && [ -x /usr/libexec/network/packet-steering.uc ]; then
	rss_off
	ring_policy other
	flows=$(uci -q get "network.@globals[0].steering_flows")
	[ "${flows:-0}" -gt 0 ] 2> /dev/null && exec /usr/libexec/network/packet-steering.uc -l "$flows" "$1"
	exec /usr/libexec/network/packet-steering.uc "$1"
fi

[ "$1" = 0 ] && off=1

if [ -z "$off" ] && [ "$(uci -q get milkflint.steering.rss)" != 0 ] && has_rss &&
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

all=$(printf %x $(((1 << $(grep -c ^processor /proc/cpuinfo)) - 1)))
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

for q in /sys/class/net/*/queues/rx-*/rps_cpus; do
	dev=${q#/sys/class/net/}
	dev=${dev%%/*}
	case "$(basename "$(readlink "/sys/class/net/$dev/device/driver")")" in
	mtk_soc_eth) m=$WORK_CPUS ;;
	*) m=0 ;;
	esac
	[ -n "$off" ] || [ -n "$rss" ] && m=0
	echo "$m" > "$q"
done
