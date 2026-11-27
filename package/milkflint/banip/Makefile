# banIP - ban incoming and outgoing IPs via named nftables Sets
# Copyright (c) 2018-2026 Dirk Brenken (dev@brenken.org)
# This is free software, licensed under the GNU General Public License v3.
#
# MilkFlint: the packages feed's banIP 1.9.2-1, from its openwrt-25.12
# branch (commit ccb56eff0a2e), unchanged, built as 1.9.2-r1001. The 25.12.6
# release pins 1.9.1-2, whose urlhaus list is at an address abuse.ch has
# taken down; 1.9.1-3 moved it to abuse.ch's export, which needs a free
# personal Auth-Key (ban_authkey, set on the banIP page), and skips it until
# one is set.
#
# Why r1001: PKG_RELEASE is upstream's + 1000, MilkFlint's own build number.
# Routers update banIP from MilkFlint's own package feed, and apk's world pins
# it as banip=<version> without the feed's tag; OpenWrt's builds never have
# an r1000 or higher, so that pin can only match MilkFlint's build, and
# OpenWrt's same-named banip can't replace it. URL is upstream's files at
# that commit, which the banIP page links as the installed version's source.

include $(TOPDIR)/rules.mk

PKG_NAME:=banip
PKG_VERSION:=1.9.2
PKG_RELEASE:=1001
PKG_LICENSE:=GPL-3.0-or-later
PKG_MAINTAINER:=Dirk Brenken <dev@brenken.org>

include $(INCLUDE_DIR)/package.mk

define Package/banip
	SECTION:=net
	CATEGORY:=Network
	TITLE:=banIP blocks IPs via named nftables Sets
	DEPENDS:=+jshn +jsonfilter +firewall4 +gawk +ca-bundle +rpcd +rpcd-mod-rpcsys
	PKGARCH:=all
	URL:=https://github.com/openwrt/packages/tree/ccb56eff0a2e/net/banip
endef

define Package/banip/description
banIP blocks IPs via named nftables Sets.
banIP supports many IP blocklist feeds and provides a log service to block suspicious IPs in realtime.
Please see https://github.com/openwrt/packages/blob/master/net/banip/README.md for further information.

endef

define Package/banip/conffiles
/etc/config/banip
/etc/banip/banip.allowlist
/etc/banip/banip.blocklist
/etc/banip/banip.custom.feeds
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/banip/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/banip-service.sh $(1)/usr/bin

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/banip.init $(1)/etc/init.d/banip

	$(INSTALL_DIR) $(1)/usr/lib
	$(INSTALL_DATA) ./files/banip-functions.sh $(1)/usr/lib

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/banip.conf $(1)/etc/config/banip

	$(INSTALL_DIR) $(1)/etc/banip
	$(INSTALL_CONF) ./files/banip.tpl $(1)/etc/banip
	$(INSTALL_CONF) ./files/banip.allowlist $(1)/etc/banip
	$(INSTALL_CONF) ./files/banip.blocklist $(1)/etc/banip
	$(INSTALL_CONF) ./files/banip.countries $(1)/etc/banip
	$(INSTALL_CONF) ./files/banip.feeds $(1)/etc/banip
	$(INSTALL_CONF) ./files/banip.custom.feeds $(1)/etc/banip

	$(INSTALL_DIR) $(1)/www/cgi-bin
	$(INSTALL_BIN) ./files/banip.cgi $(1)/www/cgi-bin/banip

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/95-banip-housekeeping $(1)/etc/uci-defaults
endef

$(eval $(call BuildPackage,banip))
