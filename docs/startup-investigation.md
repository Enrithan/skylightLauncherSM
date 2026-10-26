# Skylight auto-start on the Samsung UA43UE86AFULXL: engineering report

Date: 26 October 2026. TV: Samsung UA43UE86AFULXL (2025 Crystal 4K, "UE86AF"), Tizen 9.0, firmware per Samsung's model page T-KSU2EFUABC-0090. App under test: Skylight (`skylightTV.Skylight`), a Tizen web app (`.wgt`) with a Node background service (`skylightTV.SkylightWatch`), signed with a Samsung Partner certificate tied to this TV's DUID and installed over Developer Mode with the Apps2Samsung CLI. Everything below was measured on this TV; where a statement is only documented or only reported by others, it says so.

## 1. Root cause: why the attempts so far failed

| Attempt | What happened | Evidence |
|---|---|---|
| `prelaunch.support` metadata | No effect. Samsung states prelaunch has not been supported since 2019 TVs. | Samsung developer docs |
| Service with `on-boot="true" auto-restart="true"` (Partner-signed) | After a cold boot (power unplugged) the service was not running. It only started when Skylight was opened. | Diagnostics panel: "helper: not reachable on its port", no helper log, after the cold boot |
| SmartThings app Routine, "Then" actions | The TV exposes only power, TV Plus channel, mute, source, picture mode, sound mode. No "open app". | Checked on the Galaxy S24 Ultra |
| Cold boot with Skylight on screen when unplugged | TV came up on Samsung TV Plus (its last broadcast *source*). | Observed |

Conclusion: nothing sideloaded runs on a cold boot until something launches it, and the TV's own power-on logic restores a *source* (tuner, TV Plus, HDMI), not an app. Standby (remote power button, "Instant On") is different: apps are kept in memory and resume.

## 2. What the platform permits

- **Documented:** a TV web app may launch another installed app by id (`tizen.application.launch`, privilege `application.launch`); confirmed working here from both the page and the service. Services run as separate Node processes and survive their UI app leaving the screen (confirmed). A sub-app can be launched in the caller's group (`launchMode: GROUP`); works for ordinary apps, not for TizenTube, which hands over to Samsung's resident YouTube engine.
- **Documented but not honoured on this firmware:** `on-boot` for web services (see above). Other owners report the same on 2021–2026 models.
- **Documented, user setting:** *Start Screen Options → Autorun Last App* ("may not be supported depending on the app"). Untested here so far; one 2024 Tizen 9 owner reports it reopening a sideloaded app after standby but not after a cold boot.
- **Not available to third parties:** registering an app as a broadcast source, Samsung's home app id (none of the usual names answer), boot-to-app (signage firmware only), `tizen.power`/screen-state events for TV web apps.
- **Discovered, undocumented but stable:** `GET http://127.0.0.1:8001/api/v2/applications/<appId>` answers without a token only to callers on the TV itself and reports `{running, visible}` for any app. This is what makes Home and app-exit return to Skylight today.
- **Explicitly rejected:** rewriting the TV's `home_appid`/`startup_appid` settings (the "Clean Home" approach). Undocumented, warranty/brick risk per its own authors.

## 3. Remaining options, ranked

1. **SmartThings cloud Rule with the TV's `custom.launchapp` command.** Samsung TVs expose a `launchApp` command to the SmartThings *API* that the SmartThings *app's* Routine editor does not show. Community reports show it being driven with Tizen-style ids (for example `PvWgqxV3Xa.YouTubeTV`), which is the same id format the TV's local API accepted for our sideloaded apps. A Rule ("when the TV's switch reports on → wait 8 s → launchApp skylightTV.Skylight") runs in the SmartThings cloud, so it covers cold boots and needs no always-on device. Unverified for this TV: whether `custom.launchapp` is listed on it and whether it accepts a sideloaded id. Both are answered by one 2-minute test (section 4).
2. **Autorun Last App + TV Plus disabled.** Zero code. Likely to cover standby; cold-boot coverage doubtful. Test: set it, leave Skylight on screen, (a) power off/on with the remote, (b) unplug for a minute.
3. **PC-side watcher over the TV's LAN API.** `POST http://TV:8001/api/v2/applications/<id>` launches apps from the LAN but needs a pairing token from the remote-control WebSocket, which never produced the Allow prompt here, and it would need the PC always on. Workable only as a last resort.
4. **Companion/launcher app on the TV.** Already built (the helper). It cannot help with cold boots because it cannot start itself; it does handle Home and app exits.
5. **HDMI-CEC / external device.** CEC can switch the TV to an HDMI input, not open an app. Only relevant if the owner moves to a streaming box as the "home".

## 4. Recommended next experiment (Option 1)

Prerequisites: SmartThings account that owns the TV; a Personal Access Token from https://account.smartthings.com/tokens with scopes Devices read + execute, Locations read, Rules read + write + execute (tokens made now expire after 24 h; the Rule outlives the token).

Steps, on the PC:
1. `$env:SMARTTHINGS_TOKEN = '<token>'`
2. `F:\Proj\Tizen\tools\smartthings-skylight.ps1` — finds the TV and prints whether `custom.launchapp` is among its capabilities. Expected: a line ending `main/custom.launchapp`. If it says NOT exposed, Option 1 is closed and Option 2 is next.
3. `...\smartthings-skylight.ps1 -Test` — sends `launchApp skylightTV.Skylight`. Expected within ~5 s: Skylight opens on the TV. If the TV answers 200 but nothing opens, retry with `-AppId` set to the numeric/alternate ids the TV lists in its `custom.launchapp` status (the script prints the device status on request).
4. `...\smartthings-skylight.ps1 -CreateRule` — creates the Rule. Then: unplug the TV for a minute, power on. Expected: TV Plus/tuner for a few seconds, then Skylight. Repeat with the remote's power button.
5. `-ListRules` / `-DeleteRule <id>` to inspect or undo.

No-token alternative for steps 2–3: my.smartthings.com/advanced → Devices → the TV → send `custom.launchapp` / `launchApp` with the app id; the same page's Rules section accepts the contents of `tools\skylight-boot-rule.json` (actions array only).

## 5. Verdict (updated 26 Oct 2026, evening)

Achieved, with two SmartThings cloud Rules created by `tools\smartthings-skylight.ps1`:

- **Remote power button (standby):** rule "Open Skylight when the TV turns on" — the TV reports `switch` off→on, the rule waits 8 s and sends `custom.launchapp launchApp skylightTV.Skylight`. Confirmed working.
- **Cold boot (power unplugged):** the TV comes back still reporting "on" (no switch event) and does not update `tvChannel.tvChannelName`, so neither a switch rule nor a "tuner on screen" rule can fire. What does change on every check-in is `samsungvd.thingStatus.updatedTime` (integer). Rule "Open Skylight when the TV checks in" triggers on it (`greaterThan 0`, trigger Always), guarded by `switch == on` and `tvChannelName == skylightTV.Skylight` (stale but exactly the wanted case), then waits 15 s, sends `samsungvd.remoteControl send HOME PRESS_AND_RELEASED` (the launch is ignored while the no-aerial tuner screen is up but works from Samsung's home), waits 4 s and launches Skylight. Confirmed working; a second attempt was removed because it re-pressed Home over an already-open Skylight.

Findings worth keeping: the TV ignores `on-boot` for sideloaded services; the SmartThings app's Routine editor hides `launchApp` and `remoteControl.send`, but the Rules API accepts both; Rules command arguments must be typed operands; a token is only needed to create rules, which then run in the cloud indefinitely. Remaining limits: a cold boot taken while another app (not Skylight) was last on screen leaves that app's name in `tvChannelName`, so the cold-boot rule stays silent and one press of Home (which lands on Skylight) is needed. The cold-boot rule cannot fire before the TV's first cloud report, which on this TV comes about 90 s after a cold boot; with `-BootDelay 5` Skylight appears right after that. This model's Start Screen Options offer only "Start with Smart Hub Home" and "Autorun Samsung TV Plus" (no "Autorun Last App"), so there is no TV-side startup option to shorten that.
