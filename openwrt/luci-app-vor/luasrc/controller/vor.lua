-- SPDX-License-Identifier: GPL-3.0-or-later
module("luci.controller.vor", package.seeall)

function index()
	if not nixio.fs.access("/etc/config/vor") then
		return
	end
	entry({"admin", "vpn", "vor"}, cbi("vor"), _("VOR Secure Tunnel"), 60).dependent = true
	entry({"admin", "vpn", "vor", "status"}, call("action_status")).leaf = true
end

-- JSON status endpoint consumed by the dashboard (local only, no cloud).
function action_status()
	local uci = require("luci.model.uci").cursor()
	local running = luci.sys.call("pgrep -x xray >/dev/null") == 0
	local transport = uci:get("vor", "config", "transport") or "auto"
	local blackout = uci:get("vor", "config", "blackout") or "0"
	luci.http.prepare_content("application/json")
	luci.http.write(string.format(
		'{"running": %s, "transport": "%s", "blackout": %s, "watchdog": %s}',
		running and "true" or "false", transport,
		blackout == "1" and "true" or "false",
		luci.sys.call("pgrep -f vor-watchdog >/dev/null") == 0 and "true" or "false"))
end
