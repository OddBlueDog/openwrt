# SPDX-License-Identifier: GPL-2.0-only
#
# MilkFlint: the packages feed's net/adguardhome (openwrt-25.12 branch,
# 0.107.80), changed so that:
# - the web interface is built here from AdGuard Home's own source (client/,
#   the interface its release builds ship), with npm from its lockfile,
#   instead of downloading the prebuilt AdGuardHome_frontend.tar.gz;
# - its license and the licenses of everything built into it (Go modules and
#   the npm packages in the web interface) are installed with it;
# - the init script, its uci settings and the paths are MilkFlint's (files/),
#   and it starts only once turned on (adguardhome.config.enabled).
#
# Copyright (C) the openwrt/packages authors (net/adguardhome)

include $(TOPDIR)/rules.mk

PKG_NAME:=adguardhome
PKG_VERSION:=0.107.80
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/AdguardTeam/AdGuardHome/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=c67cf289f1d4b05c78994f4d1d169962540814a212244eb191cd599795d90278
PKG_BUILD_DIR:=$(BUILD_DIR)/AdGuardHome-$(PKG_VERSION)

PKG_LICENSE:=GPL-3.0-only
PKG_LICENSE_FILES:=LICENSE.txt
PKG_CPE_ID:=cpe:/a:adguard:adguardhome
PKG_MAINTAINER:=Dobroslaw Kijowski <dobo90@gmail.com>, George Sapkin <george@sapk.in>

# node/host builds the web interface (npm ci, then webpack)
PKG_BUILD_DEPENDS:=golang1.27/host node/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/AdguardTeam/AdGuardHome
GO_PKG_BUILD_PKG:=github.com/AdguardTeam/AdGuardHome

AGH_VERSION_PKG:=github.com/AdguardTeam/AdGuardHome/internal/version
GO_PKG_LDFLAGS_X:=$(AGH_VERSION_PKG).channel=release \
	$(AGH_VERSION_PKG).version=v$(PKG_VERSION) \
	$(AGH_VERSION_PKG).committime=$(SOURCE_DATE_EPOCH) \
	$(AGH_VERSION_PKG).goarm=$(GO_ARM) \
	$(AGH_VERSION_PKG).gomips=$(GO_MIPS)

include $(INCLUDE_DIR)/package.mk
# the Go helpers stay in the packages feed (as for dnsproxy's copy)
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/adguardhome
	SECTION:=net
	CATEGORY:=Network
	TITLE:=Network-wide ads and trackers blocking DNS server
	URL:=https://github.com/AdguardTeam/AdGuardHome
	DEPENDS:=$(GO_ARCH_DEPENDS) +ca-bundle
	USERID:=adguardhome=853:adguardhome=853
endef

define Package/adguardhome/conffiles
/etc/adguardhome/AdGuardHome.yaml
/etc/config/adguardhome
endef

define Package/adguardhome/description
Free and open source, powerful network-wide ads and trackers blocking DNS server.
endef

# npm's downloads are kept with the build's other downloads (as Go's modules
# are, in dl/go-mod-cache), so a rebuild fetches nothing again
NPM_VARS:= \
	PATH="$(STAGING_DIR_HOSTPKG)/bin:$$$$PATH" \
	HOME="$(PKG_BUILD_DIR)/.npm-home" \
	npm_config_cache="$(DL_DIR)/npm-cache" \
	npm_config_update_notifier=false \
	npm_config_fund=false \
	npm_config_audit=false

# The web interface, from client/ (what AdGuard Home's release builds use;
# client_v2/ is its next one): the exact packages package-lock.json pins,
# their install scripts not run (none is needed to build it: esbuild's only
# checks its binary, fsevents is for macOS), then webpack writes build/static,
# which the Go build embeds. Before the Go build's configure step, which
# copies the tree it builds from.
define Build/Prepare
	$(call Build/Prepare/Default)
	cd $(PKG_BUILD_DIR)/client && $(NPM_VARS) npm ci --ignore-scripts --no-progress --loglevel=error
	cd $(PKG_BUILD_DIR)/client && $(NPM_VARS) npm run build-prod
	$(NPM_VARS) node $(CURDIR)/files/notices-npm.cjs $(PKG_BUILD_DIR)/client > $(PKG_BUILD_DIR)/THIRD-PARTY-NOTICES.npm.txt
endef

# After the Go build: the license of each Go module linked into the binary
# (go list -deps of the main package, so not the modules of AdGuard Home's
# development tools). In the source tree itself: the Go build's copy of it
# has only the code, not build/static, which main.go embeds.
define Build/Compile
	$(call GoPackage/Build/Compile)
	cd $(PKG_BUILD_DIR) && \
		$(GO_GENERAL_BUILD_CONFIG_VARS) $(GO_PKG_BUILD_CONFIG_VARS) $(GO_PKG_VARS) \
		$(SHELL) $(CURDIR)/files/notices-go.sh $(GO_PKG) > $(PKG_BUILD_DIR)/THIRD-PARTY-NOTICES.go.txt
	[ "$$$$(head -n 1 $(PKG_BUILD_DIR)/THIRD-PARTY-NOTICES.go.txt)" != "0 modules" ] || \
		{ echo "adguardhome: no Go modules found for its notices" >&2; exit 1; }
endef

# The license texts go where the web interface can link to them
# (/www/licenses/adguardhome), and /usr/share/licenses/adguardhome points there.
define Package/adguardhome/install
	$(call GoPackage/Package/Install/Bin,$(1))

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/adguardhome.config $(1)/etc/config/adguardhome

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/adguardhome.init $(1)/etc/init.d/adguardhome

	$(INSTALL_DIR) $(1)/www/licenses/adguardhome $(1)/usr/share/licenses
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/LICENSE.txt $(1)/www/licenses/adguardhome/LICENSE.txt
	( \
		echo "AdGuard Home $(PKG_VERSION): the licenses of the code built into it"; \
		echo "(AdGuard Home itself is GPL-3.0: LICENSE.txt). Its source, as built:"; \
		echo "https://github.com/AdguardTeam/AdGuardHome/tree/v$(PKG_VERSION)"; \
		echo; \
		echo "=== Go modules linked into /usr/bin/AdGuardHome ==="; \
		echo; \
		cat $(PKG_BUILD_DIR)/THIRD-PARTY-NOTICES.go.txt; \
		echo; \
		echo "=== npm packages in its web interface (built into the binary) ==="; \
		echo; \
		cat $(PKG_BUILD_DIR)/THIRD-PARTY-NOTICES.npm.txt; \
	) > $(1)/www/licenses/adguardhome/THIRD-PARTY-NOTICES.txt
	$(LN) /www/licenses/adguardhome $(1)/usr/share/licenses/adguardhome
endef

$(eval $(call GoBinPackage,adguardhome))
$(eval $(call BuildPackage,adguardhome))
