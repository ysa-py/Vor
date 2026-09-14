# SPDX-License-Identifier: GPL-3.0-or-later
#
# luci-app-vor — OpenWrt LuCI application for the VOR smart anti-censorship
# tunnel (xray-core + adaptive DPI countermeasures + blackout watchdog).
#
# Build inside the OpenWrt SDK:
#   make package/luci-app-vor/compile V=s
# Produces: bin/packages/<arch>/luci-app-vor_1.0.0-1_all.ipk

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-vor
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=GPL-3.0-or-later
PKG_MAINTAINER:=VOR Engineering

LUCI_TITLE:=VOR Secure Tunnel — smart anti-DPI VPN (xray)
LUCI_DEPENDS:=+luci-base +xray-core +curl +ca-certificates +ip-full +iptables-mod-tproxy
LUCI_PKGARCH:=all

define Package/$(PKG_NAME)/conffiles
/etc/config/vor
/etc/vor/watchdog.conf
endef

define Package/$(PKG_NAME)/description
  VOR Smart Engine for OpenWrt: transport fallback ladder
  (Reality → WS+TLS+CDN → gRPC → HTTPUpgrade → SS2022), adaptive DPI
  countermeasures (ClientHello split, MSS clamp, uTLS rotation, port hopping),
  blackout watchdog with domestic DNS bootstrap, Iran-domestic split routing.
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./luasrc/controller/vor.lua $(1)/usr/lib/lua/luci/controller/vor.lua
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/model/cbi
	$(INSTALL_DATA) ./luasrc/model/cbi/vor.lua $(1)/usr/lib/lua/luci/model/cbi/vor.lua
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/vor $(1)/etc/config/vor
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./root/etc/init.d/vor $(1)/etc/init.d/vor
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/90-vor $(1)/etc/uci-defaults/90-vor
	$(INSTALL_DIR) $(1)/etc/vor
	$(INSTALL_CONF) ./root/etc/vor/watchdog.conf $(1)/etc/vor/watchdog.conf
	$(INSTALL_BIN) ./root/usr/bin/vor-watchdog $(1)/usr/bin/vor-watchdog
	$(INSTALL_BIN) ./root/usr/bin/vor-countermeasure $(1)/usr/bin/vor-countermeasure
	$(INSTALL_DIR) $(1)/etc/crontabs-root.d
	echo '*/1 * * * * /usr/bin/vor-watchdog tick' > $(1)/etc/crontabs-root.d/vor
endef

$(eval $(call Application,$(PKG_NAME)))
