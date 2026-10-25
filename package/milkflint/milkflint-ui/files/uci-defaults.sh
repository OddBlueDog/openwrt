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
