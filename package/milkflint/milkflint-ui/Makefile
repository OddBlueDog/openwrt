include $(TOPDIR)/rules.mk

PKG_NAME:=milkflint-ui
PKG_VERSION:=0.5.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/milkflint-ui
  SECTION:=luci
  CATEGORY:=LuCI
  TITLE:=MilkFlint web interface (dashboard and main settings)
  DEPENDS:=+luci-base +rpcd +rpcd-mod-ucode +rpcd-mod-iwinfo +uhttpd +uhttpd-mod-ubus \
	+ucode +ucode-mod-fs +ucode-mod-uci +ucode-mod-resolv +ethtool
  PKGARCH:=all
endef

define Package/milkflint-ui/description
  A web interface for the everyday settings, served at the router's address.
  LuCI stays installed for everything else, under "Advanced".
  htdocs/ is built from milkflint/ui/ (pnpm package).
endef

define Package/milkflint-ui/conffiles
/etc/config/milkflint
endef

define Build/Compile
endef

# Core files, then each feature's router side by convention
# (files/features/<id>/: rpcd.uc, acl.json, init, uci-defaults, preinit, bin/*).
# A preinit hook runs after preinit restores the config a sysupgrade kept
# (80_mount_root), before anything in /etc/init.d.
define Package/milkflint-ui/install
	$(INSTALL_DIR) $(1)/www/milkflint $(1)/usr/share/rpcd/acl.d $(1)/usr/share/rpcd/ucode \
		$(1)/etc/uci-defaults $(1)/etc/init.d $(1)/usr/libexec/milkflint $(1)/usr/libexec/platform \
		$(1)/etc/hotplug.d/ieee80211 $(1)/lib/preinit
	$(CP) ./htdocs/* $(1)/www/milkflint/
	$(INSTALL_BIN) ./files/packet-steering.sh $(1)/usr/libexec/platform/packet-steering.sh
	$(INSTALL_DATA) ./files/wifi-aql.hotplug $(1)/etc/hotplug.d/ieee80211/30-milkflint-aql
	$(INSTALL_DATA) ./files/wifi-hw-atf.hotplug $(1)/etc/hotplug.d/ieee80211/31-milkflint-hw-atf
	$(INSTALL_DATA) ./files/wifi-muru.hotplug $(1)/etc/hotplug.d/ieee80211/32-milkflint-muru
	$(INSTALL_DATA) ./files/milkflint.html $(1)/www/milkflint.html
	$(INSTALL_DATA) ./files/acl.json $(1)/usr/share/rpcd/acl.d/milkflint-ui.json
	$(INSTALL_DATA) ./files/rpcd.uc $(1)/usr/share/rpcd/ucode/milkflint
	$(INSTALL_BIN) ./files/uci-defaults.sh $(1)/etc/uci-defaults/90-milkflint-ui
	for f in ./files/features/*/; do \
		id=$$$$(basename $$$$f); \
		[ ! -f $$$$f/rpcd.uc ] || $(INSTALL_DATA) $$$$f/rpcd.uc $(1)/usr/share/rpcd/ucode/milkflint-$$$$id; \
		[ ! -f $$$$f/acl.json ] || $(INSTALL_DATA) $$$$f/acl.json $(1)/usr/share/rpcd/acl.d/milkflint-$$$$id.json; \
		[ ! -f $$$$f/init ] || $(INSTALL_BIN) $$$$f/init $(1)/etc/init.d/milkflint-$$$$id; \
		[ ! -f $$$$f/uci-defaults ] || $(INSTALL_BIN) $$$$f/uci-defaults $(1)/etc/uci-defaults/91-milkflint-$$$$id; \
		[ ! -f $$$$f/preinit ] || $(INSTALL_DATA) $$$$f/preinit $(1)/lib/preinit/81_milkflint-$$$$id; \
		[ ! -d $$$$f/bin ] || $(INSTALL_BIN) $$$$f/bin/* $(1)/usr/libexec/milkflint/; \
	done
endef

$(eval $(call BuildPackage,milkflint-ui))
