# SPDX-License-Identifier: GPL-2.0-only
#
# MilkFlint: packages AdGuard Home's official Linux arm64 release binary from
# GitHub Releases (pinned by PKG_HASH) with MilkFlint's init script, uci
# settings, jail, and paths, and off until turned on (adguardhome.config.enabled).
# Updating is a PKG_VERSION + PKG_HASH bump — no Go or Node host build needed.
#
# Why r1001: PKG_RELEASE is upstream's + 1000, MilkFlint's own build number.
# Routers update AdGuard Home from MilkFlint's own package feed, and apk's
# world pins it as adguardhome=<version> without the feed's tag; OpenWrt's
# builds never have an r1000 or higher, so that pin can only match
# MilkFlint's build, and OpenWrt's same-named adguardhome (1.0.0-r1 in 25.12.6)
# can't replace it.
#
# Copyright (C) the openwrt/packages authors (net/adguardhome)

include $(TOPDIR)/rules.mk

PKG_NAME:=adguardhome
PKG_VERSION:=1.0.0
PKG_RELEASE:=1001

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION)-linux-arm64.tar.gz
PKG_SOURCE_URL:=https://github.com/AdguardTeam/AdGuardHome/releases/download/v$(PKG_VERSION)/AdGuardHome_linux_arm64.tar.gz?
PKG_HASH:=f5c331d29580726179d3119c0464ddacd6fdcd487a0a9e108532f58fdf772604
PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE.txt
PKG_CPE_ID:=cpe:/a:adguard:adguardhome
PKG_MAINTAINER:=Dobroslaw Kijowski <dobo90@gmail.com>, George Sapkin <george@sapk.in>

# Already a statically linked, stripped Go binary; OpenWrt's sstrip would break it
RSTRIP:=:

include $(INCLUDE_DIR)/package.mk

define Package/adguardhome
	SECTION:=net
	CATEGORY:=Network
	TITLE:=Network-wide ads and trackers blocking DNS server
	URL:=https://github.com/AdguardTeam/AdGuardHome
	DEPENDS:=@aarch64 +ca-bundle
	USERID:=adguardhome=853:adguardhome=853
endef

define Package/adguardhome/conffiles
/etc/adguardhome/AdGuardHome.yaml
/etc/config/adguardhome
endef

define Package/adguardhome/description
Free and open source, powerful network-wide ads and trackers blocking DNS server.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(HOST_TAR) -xzf $(DL_DIR)/$(PKG_SOURCE) -C $(PKG_BUILD_DIR) --strip-components=2 ./AdGuardHome
endef

define Build/Configure
endef

define Build/Compile
endef

# The license text goes where the web interface can link to it
# (/www/licenses/adguardhome), and /usr/share/licenses/adguardhome points there.
define Package/adguardhome/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/AdGuardHome $(1)/usr/bin/AdGuardHome

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/adguardhome.config $(1)/etc/config/adguardhome

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/adguardhome.init $(1)/etc/init.d/adguardhome

	$(INSTALL_DIR) $(1)/www/licenses/adguardhome $(1)/usr/share/licenses
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/LICENSE.txt $(1)/www/licenses/adguardhome/LICENSE.txt
	$(LN) /www/licenses/adguardhome $(1)/usr/share/licenses/adguardhome
endef

$(eval $(call BuildPackage,adguardhome))
