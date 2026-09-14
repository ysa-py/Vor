-- SPDX-License-Identifier: GPL-3.0-or-later
local m, s

m = Map("vor", translate("VOR Secure Tunnel"),
	translate("Smart anti-censorship tunnel: transport fallback ladder, adaptive DPI countermeasures, blackout watchdog. Domestic (IR) traffic always routes DIRECT."))

s = m:section(NamedSection, "config", "vor", translate("General"))
s.addremove = false
s:option(Flag, "enabled", translate("Enable tunnel")).rmempty = false

local transport = s:option(ListValue, "transport", translate("Transport class"),
	translate("Engine auto-escalates down the ladder on failures unless Auto is selected"))
transport:value("auto", translate("AUTO - Smart Engine"))
transport:value("reality_direct", "VLESS + Reality + uTLS")
transport:value("ws_tls_cdn", "VLESS + WS + TLS + CDN")
transport:value("grpc_tls", "gRPC + TLS")
transport:value("httpupgrade_cdn", "HTTPUpgrade + CDN")
transport:value("ss2022", "Shadowsocks-2022")
transport.default = "auto"
transport.rmempty = false

s:option(Flag, "blackout", translate("Blackout mode"),
	translate("International cut suspected: CDN-only endpoints + domestic DNS bootstrap"))

s = m:section(NamedSection, "dpi", "vor", translate("Anti-DPI countermeasures"))
local split = s:option(ListValue, "clienthello_split", translate("TLS ClientHello split"),
	"Splits hello to defeat SNI reassembly")
split:value("off", "OFF")
for _, v in ipairs({"1", "5", "7", "13"}) do split:value(v, v) end
split.default = "off"
s:option(Value, "mss_clamp", translate("MSS clamp"), "e.g. 48 aggressive / 88 moderate")
s:option(Flag, "utls_randomized", translate("Randomized uTLS fingerprint"))
s:option(Flag, "fake_sni", translate("Fronted SNI (cdn.jsdelivr.net)"))
local hop = s:option(Flag, "port_hopping", translate("Port hopping"))
hop.rmempty = false
s:option(Value, "port_range", translate("Hop range"), "e.g. 10000-20000").depends("port_hopping", "1")
s:option(Value, "hop_interval", translate("Hop interval (s)")).depends("port_hopping", "1")

s = m:section(NamedSection, "endpoint", "vor", translate("Endpoint"))
s:option(Value, "address", translate("Server address")).datatype = "host"
s:option(Value, "port", translate("Port")).datatype = "port"
s:option(Value, "uuid", translate("UUID / password"))
s:option(Value, "sni", translate("SNI"))
s:option(Value, "public_key", translate("Reality public key (pbk)"))
s:option(Value, "short_id", translate("Reality short id (sid)"))
s:option(Value, "path", translate("WS path"))
s:option(Value, "host", translate("WS/CDN host header"))

return m
