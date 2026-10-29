include $(TOPDIR)/rules.mk

PKG_NAME:=milkflint-rtprio
PKG_VERSION:=1.0
PKG_RELEASE:=1
PKG_LICENSE:=MIT

include $(INCLUDE_DIR)/package.mk

define Package/milkflint-rtprio
  SECTION:=utils
  CATEGORY:=Utilities
  TITLE:=Show or set a thread's scheduling policy
endef

define Package/milkflint-rtprio/description
  rtprio PID [fifo|rr PRIO | other]: what chrt does, through the system calls
  (musl's sched_setscheduler() is a stub, so busybox's chrt can't set a
  policy). MilkFlint's packet steering uses it for the network threads.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) $(TARGET_LDFLAGS) -Wall \
		-o $(PKG_BUILD_DIR)/rtprio $(PKG_BUILD_DIR)/rtprio.c
endef

define Package/milkflint-rtprio/install
	$(INSTALL_DIR) $(1)/usr/libexec/milkflint
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/rtprio $(1)/usr/libexec/milkflint/
endef

$(eval $(call BuildPackage,milkflint-rtprio))
