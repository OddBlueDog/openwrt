#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#
# MilkFlint: the packages feed's gawk 5.3.2 (banIP needs GNU awk), with
# three changes. It isn't the system's awk: the feed's package makes
# /usr/bin/awk gawk (ALTERNATIVES), which would hand every script on the
# router a different, slower-starting awk than the one it was written and
# tested with; banIP calls gawk by name. No readline (or ncurses, which only
# readline needs here): that's for gawk's interactive debugger. Only the
# program: not its dynamic extensions or awk library scripts, which banIP
# doesn't use.

include $(TOPDIR)/rules.mk

PKG_NAME:=gawk
PKG_VERSION:=5.3.2
PKG_RELEASE:=2

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.xz
PKG_SOURCE_URL:=@GNU/gawk
PKG_HASH:=f8c3486509de705192138b00ef2c00bbbdd0e84c30d5c07d23fc73a9dc4cc9cc

PKG_MAINTAINER:=Daniel Golle <daniel@makrotopia.org>
PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=COPYING

PKG_INSTALL:=1
PKG_BUILD_PARALLEL:=1

include $(INCLUDE_DIR)/package.mk

define Package/gawk
  SECTION:=utils
  CATEGORY:=Utilities
  URL:=https://www.gnu.org/software/gawk/
  TITLE:=GNU awk
endef

CONFIGURE_ARGS+= --disable-mpfr --without-readline

define Package/gawk/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(CP) $(PKG_INSTALL_DIR)/usr/bin/gawk $(1)/usr/bin/
endef

$(eval $(call BuildPackage,gawk))
