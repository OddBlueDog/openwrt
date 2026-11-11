#!/bin/sh
# Serve milkflint-ui at the router's address: uhttpd tries milkflint.html
# before LuCI's index.html. LuCI itself stays at /cgi-bin/luci/.
case " $(uci -q get uhttpd.main.index_page) " in
	*" milkflint.html "*) ;;
	*)
		uci set uhttpd.main.index_page='milkflint.html index.html'
		uci commit uhttpd
		;;
esac

# Don't answer pings from the internet: OpenWrt's Allow-Ping rule only tells
# scanners the address is in use (ShieldsUP's TruStealth fails on it). IPv4
# only; IPv6 needs its ICMP rules. Once, marked in /etc/config/milkflint
# (kept over upgrades), because uci-defaults run again after every upgrade
# and turning it back on in LuCI should stick.
[ -f /etc/config/milkflint ] || touch /etc/config/milkflint
if [ -z "$(uci -q get milkflint.defaults.ping_off)" ]; then
	for rule in $(uci -q show firewall | sed -n "s/^firewall\.\([^.]*\)\.name='Allow-Ping'$/\1/p"); do
		uci set "firewall.$rule.enabled=0"
	done
	uci commit firewall
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.ping_off='1'
		commit milkflint
	UCI
fi

# Every port the router doesn't open stays silent to the internet ("stealth"
# in ShieldsUP and other online port tests): the wan zone drops what it
# doesn't accept. OpenWrt's default, reject, answers with a TCP reset or an
# ICMP "unreachable", which shows the port as closed. Port forwards and the
# accept rules (DHCP renew, the ICMPv6 IPv6 needs) still work. Once, like
# ping_off.
if [ -z "$(uci -q get milkflint.defaults.stealth)" ]; then
	for zone in $(uci -q show firewall | sed -n "s/^firewall\.\([^.]*\)\.name='wan'$/\1/p"); do
		uci set "firewall.$zone.input=DROP"
		uci set "firewall.$zone.forward=DROP"
	done
	uci commit firewall
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.stealth='1'
		commit milkflint
	UCI
fi

# Silent over IPv6 too, where each device at home has an address of its
# own. What the internet sends a device unasked falls to the global forward
# policy (a zone's forward policy only covers traffic within the zone),
# which OpenWrt sets to REJECT: with stealth on it becomes DROP. Port
# forwards, UPnP and replies still get through. With pings off, IPv6 pings
# go unanswered too, by the router and by devices: echo-request comes out of
# OpenWrt's two ICMPv6 rules, which keep the rest (what IPv6 needs to work).
# Each follows the choice already made for IPv4 (stealth, Allow-Ping), so it
# changes nothing someone turned back on. Once, like ping_off.
if [ -z "$(uci -q get milkflint.defaults.stealth_ipv6)" ]; then
	stealth=
	for zone in $(uci -q show firewall | sed -n "s/^firewall\.\([^.]*\)\.name='wan'$/\1/p"); do
		[ "$(uci -q get "firewall.$zone.input")" = DROP ] && stealth=1
	done
	if [ -n "$stealth" ]; then
		for section in $(uci -q show firewall | sed -n "s/^firewall\.\([^.=]*\)=defaults$/\1/p"); do
			[ "$(uci -q get "firewall.$section.forward")" = REJECT ] && uci set "firewall.$section.forward=DROP"
		done
	fi
	ping=
	for rule in $(uci -q show firewall | sed -n "s/^firewall\.\([^.]*\)\.name='Allow-Ping'$/\1/p"); do
		[ "$(uci -q get "firewall.$rule.enabled")" = 0 ] || ping=1
	done
	if [ -z "$ping" ]; then
		for rule in $(uci -q show firewall | sed -n "s/^firewall\.\([^.]*\)\.name='Allow-ICMPv6-[A-Za-z]*'$/\1/p"); do
			# no types left would mean every type
			[ "$(uci -q get "firewall.$rule.icmp_type")" = echo-request ] && continue
			uci -q del_list "firewall.$rule.icmp_type=echo-request"
		done
	fi
	uci -q commit firewall
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.stealth_ipv6='1'
		commit milkflint
	UCI
fi

# Smart Queue uses multi-queue CAKE (cake_mq): one CAKE per transmit queue
# sharing the configured speed, so shaping isn't tied to one queue's lock.
# Needs the kernel's sch_cake fix (source/patches/0003); without it cake_mq
# collapses. Once, like ping_off, so turning it off in LuCI sticks.
if [ -z "$(uci -q get milkflint.defaults.cake_mq)" ]; then
	for queue in $(uci -q show sqm | sed -n "s/^sqm\.\([^.=]*\)=queue$/\1/p"); do
		uci set "sqm.$queue.use_mq=1"
	done
	uci -q commit sqm
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.cake_mq='1'
		commit milkflint
	UCI
fi

# Upload stays one CAKE on the Ethernet's ports: mtk_eth sends all of a
# port's traffic on one transmit queue, so egress cake_mq ran one busy
# sub-cake beside 15 idle ones (~1 MiB each) for a little more CPU. sqm's
# use_mq_egress is our sqm-scripts patch; download keeps cake_mq. Once, so
# changing it sticks.
if [ -z "$(uci -q get milkflint.defaults.cake_mq_egress)" ]; then
	for queue in $(uci -q show sqm | sed -n "s/^sqm\.\([^.=]*\)=queue$/\1/p"); do
		dev=$(uci -q get "sqm.$queue.interface")
		[ "$(basename "$(readlink "/sys/class/net/$dev/device/driver")")" = mtk_soc_eth ] &&
			uci set "sqm.$queue.use_mq_egress=0"
	done
	uci -q commit sqm
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.cake_mq_egress='1'
		commit milkflint
	UCI
fi

# Software flow offloading (fw4's flow_offloading): an established
# connection's packets go from the receiving port straight to the other
# port's transmit, past conntrack, NAT's hooks, routing and the forward
# chain. CAKE still shapes every one: our kernel attaches each packet's
# conntrack entry, so nat mode keeps its per-device fairness, and ifb hands
# shaped downloads to the flowtable (source/patches/0014). Less CPU for the
# same latency. Not over hardware offloading, which bypasses CAKE. Once,
# like ping_off.
if [ -z "$(uci -q get milkflint.defaults.flow_offload)" ]; then
	for section in $(uci -q show firewall | sed -n "s/^firewall\.\([^.=]*\)=defaults$/\1/p"); do
		[ "$(uci -q get "firewall.$section.flow_offloading_hw")" = 1 ] && continue
		uci set "firewall.$section.flow_offloading=1"
	done
	uci -q commit firewall
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.flow_offload='1'
		commit milkflint
	UCI
fi

# SYN flood protection lets each address open 200 new connections a second
# to the router, and 400 at once, instead of fw4's 25 and 50. Our fw4 counts
# every address on its own (source/patches/0053), so this is per device,
# and nothing that goes through the router (to the internet) is counted at
# all; past the limit, the kernel's SYN cookies still guard the router.
# Only where no rate is set: one chosen on the Firewall page (which also
# turns the protection off) or in LuCI stays. Once, like ping_off.
if [ -z "$(uci -q get milkflint.defaults.synflood)" ]; then
	for section in $(uci -q show firewall | sed -n "s/^firewall\.\([^.=]*\)=defaults$/\1/p"); do
		[ -n "$(uci -q get "firewall.$section.synflood_rate")" ] && continue
		uci set "firewall.$section.synflood_rate=200/second"
		uci set "firewall.$section.synflood_burst=400"
	done
	uci -q commit firewall
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.synflood='1'
		commit milkflint
	UCI
fi

# Multi-queue CAKE goes with the download speed: from 500 Mbit/s, and one
# CAKE below that. Each of cake_mq's queues holds its packets to its own
# share of the speed, so a packet waits behind another for longer than in
# one CAKE, the more the slower the line, and one CPU shapes a slower line
# easily. The web interface keeps use_mq in step with the speed it saves,
# unless it's chosen there (milkflint.cake.multi_queue). A queue with
# cake_mq off was a choice and stays off; the web interface's queue is the
# first. Not a guest network's or the VPN's shaper. Once, like cake_mq.
if [ -z "$(uci -q get milkflint.defaults.cake_mq_auto)" ]; then
	first=1
	for queue in $(uci -q show sqm | sed -n "s/^sqm\.\([^.=]*\)=queue$/\1/p"); do
		case "$(uci -q get "sqm.$queue.interface")" in br-guest* | wg_out) continue ;; esac
		if [ "$(uci -q get "sqm.$queue.use_mq")" != 1 ]; then
			[ -z "$first" ] || uci -q batch <<-UCI
				set milkflint.cake=cake
				set milkflint.cake.multi_queue='0'
			UCI
		elif ! [ "$(uci -q get "sqm.$queue.download")" -ge 500000 ] 2> /dev/null; then
			uci set "sqm.$queue.use_mq=0"
		fi
		first=
	done
	uci -q commit sqm
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.cake_mq_auto='1'
		commit milkflint
	UCI
fi

# Download shaping of 500 Mbit/s and more uses CAKE's no-split-gso: CAKE
# takes GRO packets whole instead of splitting each one (64 KB is ~1 ms at
# 500 Mbit/s), which saves CPU at those speeds. The web interface keeps it in
# step with the speed it saves, unless Performance Tuning sets it
# (milkflint.gro.whole).
# Once, like cake_mq.
if [ -z "$(uci -q get milkflint.defaults.sqm_gso)" ]; then
	for queue in $(uci -q show sqm | sed -n "s/^sqm\.\([^.=]*\)=queue$/\1/p"); do
		[ "$(uci -q get "sqm.$queue.download")" -ge 500000 ] 2> /dev/null || continue
		opts=$(uci -q get "sqm.$queue.iqdisc_opts")
		case " $opts " in *" no-split-gso "*) continue ;; esac
		uci set "sqm.$queue.iqdisc_opts=${opts:+$opts }no-split-gso"
		uci set "sqm.$queue.qdisc_advanced=1"
		uci set "sqm.$queue.qdisc_really_really_advanced=1"
	done
	uci -q commit sqm
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.sqm_gso='1'
		commit milkflint
	UCI
fi

# 5 GHz Wi-Fi: under a big download the router fills the air with long
# transmissions, and a client's own packets (its TCP ACKs, a speed test's
# latency probes) wait for a turn, which can be most of the latency a
# download adds. The router's best-effort queue drops OpenWrt's 2 ms TXOP
# burst and picks its backoff from 0-31 slots instead of 0-15, so a client
# gets in sooner, for the same throughput. Once, like ping_off.
if [ -z "$(uci -q get milkflint.defaults.wifi_be)" ]; then
	for radio in $(uci -q show wireless | sed -n "s/^wireless\.\([^.=]*\)=wifi-device$/\1/p"); do
		[ "$(uci -q get "wireless.$radio.band")" = 5g ] || continue
		uci set "wireless.$radio.tx_burst=0"
		uci -q del_list "wireless.$radio.hostapd_options=tx_queue_data2_cwmin=31"
		uci add_list "wireless.$radio.hostapd_options=tx_queue_data2_cwmin=31"
	done
	uci -q commit wireless
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.wifi_be='1'
		commit milkflint
	UCI
fi

# Wi-Fi 6: the router's radio can schedule a device's uplink, and a device
# that was just scheduled has to hold back its own access to the air for a
# while. The access point says how much and for how long (its MU EDCA
# parameters), and OpenWrt's say: a backoff from up to 511 slots instead of
# 15, for two seconds after each scheduled send. That costs nothing while
# the router keeps scheduling the device. When the router is busy sending
# (a slow device's long frames, say) it stops, and the device can hardly
# get a turn by itself: its packets, a download's ACKs among them, stall
# for a good part of a second. With the timer at its shortest (8 ms) a
# device is back on its normal access almost at once. On every radio, for
# each traffic class without a timer of its own; once, after the Wi-Fi
# config exists, like wifi_dtim.
if [ -z "$(uci -q get milkflint.defaults.wifi_mu_edca)" ]; then
	found=
	for radio in $(uci -q show wireless | sed -n "s/^wireless\.\([^.=]*\)=wifi-device$/\1/p"); do
		found=1
		for ac in be bk vi vo; do
			[ -n "$(uci -q get "wireless.$radio.he_mu_edca_ac_${ac}_timer")" ] && continue
			uci set "wireless.$radio.he_mu_edca_ac_${ac}_timer=1"
		done
	done
	if [ -n "$found" ]; then
		uci -q commit wireless
		uci -q batch <<-UCI
			set milkflint.defaults=defaults
			set milkflint.defaults.wifi_mu_edca='1'
			commit milkflint
		UCI
	fi
fi

# Airtime fairness (features/airtime) on every band, once: a device with a
# poor link gets a smaller share of the air while others want it, worked out
# as it goes at the balanced strength (a share in proportion to its useful
# rate). A band whose shares were already chosen keeps them; after this,
# switching a band off or back to goals set by hand stays as chosen.
if [ -z "$(uci -q get milkflint.defaults.airtime)" ]; then
	uci -q get milkflint.wifi > /dev/null || uci set milkflint.wifi=wifi
	for band in 2g 5g 6g; do
		uci set "milkflint.wifi.airtime_$band=1"
		[ -n "$(uci -q get "milkflint.wifi.airtime_${band}_auto")" ] || uci set "milkflint.wifi.airtime_${band}_auto=balanced"
	done
	uci -q batch <<-UCI
		set milkflint.defaults=defaults
		set milkflint.defaults.airtime='1'
		commit milkflint
	UCI
fi

# DTIM 1 instead of OpenWrt's 2: devices in power save get
# broadcast and multicast (ARP, IPv6 neighbour discovery) every beacon
# instead of every other. Only on access points without a DTIM of their
# own; once, after the Wi-Fi config exists (wireless.@wifi-iface).
if [ -z "$(uci -q get milkflint.defaults.wifi_dtim)" ]; then
	found=
	for iface in $(uci -q show wireless | sed -n "s/^wireless\.\([^.=]*\)=wifi-iface$/\1/p"); do
		found=1
		[ "$(uci -q get "wireless.$iface.mode")" = ap ] || continue
		[ -n "$(uci -q get "wireless.$iface.dtim_period")" ] && continue
		uci set "wireless.$iface.dtim_period=1"
	done
	if [ -n "$found" ]; then
		uci -q commit wireless
		uci -q batch <<-UCI
			set milkflint.defaults=defaults
			set milkflint.defaults.wifi_dtim='1'
			commit milkflint
		UCI
	fi
fi
exit 0
