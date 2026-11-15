include $(TOPDIR)/rules.mk

PKG_NAME:=milkflint-bcrypt
PKG_VERSION:=1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/milkflint-bcrypt
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=bcrypt password hashes (for AdGuard Home's users)
endef

define Package/milkflint-bcrypt/description
  bcrypt < password: prints a bcrypt hash (cost 10) of a password read on
  stdin; bcrypt check HASH < password: whether it matches. Through musl's
  crypt(). MilkFlint's AdGuard Home page sets AdGuard Home's password with it.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -Wall -Wextra \
		-o $(PKG_BUILD_DIR)/bcrypt $(PKG_BUILD_DIR)/bcrypt.c -lcrypt
endef

define Package/milkflint-bcrypt/install
	$(INSTALL_DIR) $(1)/usr/libexec/milkflint
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/bcrypt $(1)/usr/libexec/milkflint/
endef

$(eval $(call BuildPackage,milkflint-bcrypt))
