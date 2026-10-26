# Uses the SmartThings cloud API to (1) check whether the TV accepts an "open app" command,
# (2) test-launch Skylight, and (3) create a cloud Rule that opens Skylight whenever the TV turns
# on. Runs on your PC with YOUR token; nothing here stores or prints it.
#
#   1. Create a token at https://account.smartthings.com/tokens with these scopes:
#      Devices: read, execute   Locations: read   Rules: read, write, execute
#      (new tokens expire after 24 h; the Rule it creates lives on in the cloud regardless)
#   2. In PowerShell:   $env:SMARTTHINGS_TOKEN = '<paste token>'
#   3. Then:            .\smartthings-skylight.ps1                 # find the TV, show its app commands
#                       (add -TvName "Living room TV" if you have several TVs)
#                       .\smartthings-skylight.ps1 -Test          # open Skylight on the TV right now
#                       .\smartthings-skylight.ps1 -CreateRule    # TV turns on -> open Skylight
#                       .\smartthings-skylight.ps1 -ListRules
#                       .\smartthings-skylight.ps1 -DeleteRule <rule id>
param(
  [switch]$Test,
  [switch]$CreateRule,
  [switch]$ListRules,
  [string]$DeleteRule,
  [switch]$Status,     # every capability the TV exposes, with its current values
  [switch]$History,    # the TV's recent events (what changed, and when)
  [switch]$BootRule,   # second rule: TV lands on the tuner with no app showing -> open Skylight (didn't match on this TV)
  [string]$BootChannelName = '',  # what tvChannelName reads on the tuner screen
  [switch]$ReportRule, # second rule, take two: the TV checks in (new status timestamp) while Skylight was last on screen
  [int]$BootDelay = 15, # seconds the check-in rule waits before pressing Home (15 worked; try less)
  [switch]$NoHomeKey,   # check-in rule: skip the Home press (for a TV set to start on Samsung's home)
  [string]$Execute,    # run a rule now, by id (tests its conditions and its launch command on demand)
  [string]$Capability, # print a capability's attribute definitions, e.g. samsungvd.thingStatus
  [string]$AppId = 'skylightTV.Skylight',
  [string]$TvName = '',  # the TV's name in SmartThings; leave empty to pick the first TV found
  [int]$DelaySeconds = 8
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$token = "$env:SMARTTHINGS_TOKEN".Trim().Trim("'", '"', '<', '>', ' ')
if (-not $token) { Write-Host "Set `$env:SMARTTHINGS_TOKEN first (see the notes at the top of this script)."; exit 2 }
if ($token -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
  Write-Host "The token doesn't look like a SmartThings personal access token (expected 36 characters like 8-4-4-4-12 hex). Length seen: $($token.Length)."
  Write-Host 'Make a new one at https://account.smartthings.com/tokens and set $env:SMARTTHINGS_TOKEN again in this same window.'
  exit 2
}
$api = 'https://api.smartthings.com/v1'
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

function Call([string]$method, [string]$path, $body) {
  $args = @{ Method = $method; Uri = "$api$path"; Headers = $headers }
  if ($body -ne $null) { $args.Body = ($body | ConvertTo-Json -Depth 20 -Compress) }
  try {
    return Invoke-RestMethod @args
  } catch {
    $resp = $_.Exception.Response
    $detail = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    elseif ($resp) { try { $detail = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } catch {} }
    $code = if ($resp) { $resp.StatusCode.value__ } else { '?' }
    if ($body -ne $null) { Write-Host "Request body was:`n$($body | ConvertTo-Json -Depth 20)" }
    throw "SmartThings answered $code for $method $path`n$detail"
  }
}

# ---- Find the TV ------------------------------------------------------------------------------
$devices = (Call GET '/devices').items
$tv = $null
if ($TvName) { $tv = $devices | Where-Object { $_.label -eq $TvName } | Select-Object -First 1 }
if (-not $tv) {
  # A Samsung TV exposes the app-launch capability; prefer that over guessing from the name.
  $tv = $devices | Where-Object { @($_.components | ForEach-Object { $_.capabilities.id }) -contains 'custom.launchapp' } | Select-Object -First 1
}
if (-not $tv) { $tv = $devices | Where-Object { "$($_.deviceTypeName) $($_.name) $($_.label)" -match 'TV' } | Select-Object -First 1 }
if (-not $tv) { 'No TV found. Devices on this account:'; $devices | ForEach-Object { "  $($_.label)  [$($_.deviceId)]  $($_.deviceTypeName)" }; exit 1 }
"TV: $($tv.label)  id $($tv.deviceId)  location $($tv.locationId)"

$caps = @()
foreach ($c in $tv.components) { foreach ($cap in $c.capabilities) { $caps += "$($c.id)/$($cap.id)" } }
$launch = $caps | Where-Object { $_ -match 'launchapp|launchApp' }
"App-launch capability: $(if ($launch) { $launch -join ', ' } else { 'NOT exposed for this TV' })"

if ($Status) {
  "All capabilities: $($caps -join ', ')"
  $st = Call GET "/devices/$($tv.deviceId)/status"
  foreach ($comp in $st.components.PSObject.Properties) {
    foreach ($cap in $comp.Value.PSObject.Properties) {
      foreach ($attr in $cap.Value.PSObject.Properties) {
        $v = $attr.Value.value
        if ($v -ne $null) {
          $shown = if ("$v" -eq '') { '""' } elseif ($v -is [string] -or $v -is [ValueType]) { "$v" } else { ($v | ConvertTo-Json -Compress -Depth 5) }
          if ($shown.Length -gt 120) { $shown = $shown.Substring(0, 120) + '...' }
          '  {0}/{1}.{2} = {3}   ({4})' -f $comp.Name, $cap.Name, $attr.Name, $shown, $attr.Value.timestamp
        }
      }
    }
  }
}

if ($History) {
  # The same feed the SmartThings app shows under the device's History.
  $h = Call GET "/history/devices?locationId=$($tv.locationId)&deviceId=$($tv.deviceId)&limit=60"
  $items = if ($h.items) { $h.items } else { $h }
  'Recent events, newest first (local time):'
  foreach ($e in $items) {
    $t = if ($e.epoch) { [DateTimeOffset]::FromUnixTimeMilliseconds([long]$e.epoch).ToLocalTime().ToString('HH:mm:ss') } else { $e.time }
    '  {0}  {1}.{2} = {3}' -f $t, $e.capability, $e.attribute, $e.value
  }
}

# ---- Test the command ---------------------------------------------------------------------------
if ($Test) {
  "Asking the TV to open $AppId ..."
  $r = Call POST "/devices/$($tv.deviceId)/commands" @{ commands = @(@{ component = 'main'; capability = 'custom.launchapp'; command = 'launchApp'; arguments = @($AppId) }) }
  "Response: $($r | ConvertTo-Json -Compress)"
  'Look at the TV: did Skylight open?'
}

# ---- The Rule: whenever the TV reports "on", wait a little, then open Skylight --------------------
$rule = @{
  name = 'Open Skylight when the TV turns on'
  actions = @(
    @{
      if = @{
        equals = @{
          left = @{ device = @{ devices = @($tv.deviceId); component = 'main'; capability = 'switch'; attribute = 'switch'; trigger = 'Always' } }
          right = @{ string = 'on' }
        }
        then = @(
          # Unlike the direct command endpoint, Rules take typed values here: {"string": ...}.
          @{ command = @{ devices = @($tv.deviceId); commands = @(@{ component = 'main'; capability = 'custom.launchapp'; command = 'launchApp'; arguments = @(@{ string = $AppId }) }) } }
        )
      }
    }
  )
}

# A pause before the launch (the TV reports "on" before it can open apps). Pass -DelaySeconds 0 to leave it out.
if ($DelaySeconds -gt 0) {
  $rule.actions[0].if.then = @(@{ sleep = @{ duration = @{ value = @{ integer = $DelaySeconds }; unit = 'Second' } } }) + $rule.actions[0].if.then
}

if ($CreateRule) {
  $r = Call POST "/rules?locationId=$($tv.locationId)" $rule
  "Rule created: $($r.name)  id $($r.id)"
  'From now on, when the TV turns on, SmartThings waits a few seconds and opens Skylight.'
}

# ---- The cold-boot Rule: unplugging never reports "off", so key on what the TV shows instead -----
# The TV reports the app on screen in tvChannel.tvChannelName. After a cold boot it lands on the
# tuner (input "dtv") with no app, so that value changes away from Skylight; HDMI inputs never match.
function DeviceOperand([string]$capability, [string]$attribute, [string]$trigger) {
  return @{ device = @{ devices = @($tv.deviceId); component = 'main'; capability = $capability; attribute = $attribute; trigger = $trigger } }
}
function Pause([int]$seconds) {
  return @{ sleep = @{ duration = @{ value = @{ integer = $seconds }; unit = 'Second' } } }
}
function PressKey([string]$key) {
  return @{ command = @{ devices = @($tv.deviceId); commands = @(@{ component = 'main'; capability = 'samsungvd.remoteControl'; command = 'send'; arguments = @(@{ string = $key }, @{ string = 'PRESS_AND_RELEASED' }) }) } }
}
function LaunchSkylight {
  return @{ command = @{ devices = @($tv.deviceId); commands = @(@{ component = 'main'; capability = 'custom.launchapp'; command = 'launchApp'; arguments = @(@{ string = $AppId }) }) } }
}
$tunerRule = @{
  name = 'Open Skylight when the TV starts on the tuner'
  actions = @(
    @{
      if = @{
        and = @(
          @{ equals = @{ left = (DeviceOperand 'tvChannel' 'tvChannelName' 'Always'); right = @{ string = $BootChannelName } } },
          @{ equals = @{ left = (DeviceOperand 'samsungvd.mediaInputSource' 'inputSource' 'Never'); right = @{ string = 'dtv' } } },
          @{ equals = @{ left = (DeviceOperand 'switch' 'switch' 'Never'); right = @{ string = 'on' } } }
        )
        then = @(
          @{ sleep = @{ duration = @{ value = @{ integer = 3 }; unit = 'Second' } } },
          @{ command = @{ devices = @($tv.deviceId); commands = @(@{ component = 'main'; capability = 'custom.launchapp'; command = 'launchApp'; arguments = @(@{ string = $AppId }) }) } }
        )
      }
    }
  )
}
if ($BootRule) {
  $r = Call POST "/rules?locationId=$($tv.locationId)" $tunerRule
  "Rule created: $($r.name)  id $($r.id)"
  'From now on, when the TV comes up on the tuner with nothing running, SmartThings opens Skylight.'
}

# ---- The cold-boot Rule, take two ---------------------------------------------------------------
# On a cold boot the TV reports the same "on" as before (no event) and doesn't update the on-screen
# app, but samsungvd.thingStatus.updatedTime is a timestamp, so every check-in is a new value and
# an event. Guard: the TV is on, and the last app it recorded on screen was Skylight (stale after a
# boot, which is exactly the case wanted; while another app is showing, it names that app instead).
$checkinRule = @{
  name = 'Open Skylight when the TV checks in'
  actions = @(
    @{
      if = @{
        and = @(
          # updatedTime is numeric (the validator rejects string operands for it) and always positive,
          # so this is true on every check-in; "trigger: Always" makes each check-in evaluate it.
          @{ greaterThan = @{ left = (DeviceOperand 'samsungvd.thingStatus' 'updatedTime' 'Always'); right = @{ integer = 0 } } },
          @{ equals = @{ left = (DeviceOperand 'switch' 'switch' 'Never'); right = @{ string = 'on' } } },
          @{ equals = @{ left = (DeviceOperand 'tvChannel' 'tvChannelName' 'Never'); right = @{ string = $AppId } } }
        )
        # The launch is ignored while the no-aerial tuner screen is up, but works from Samsung's home,
        # so press Home first (observed by hand). One attempt: 15 s after the check-in proved to be
        # late enough, and a retry would press Home again over a Skylight that is already showing.
        then = $(if ($NoHomeKey) { @((Pause $BootDelay), (LaunchSkylight)) } else { @((Pause $BootDelay), (PressKey 'HOME'), (Pause 4), (LaunchSkylight)) })
      }
    }
  )
}
if ($ReportRule) {
  $r = Call POST "/rules?locationId=$($tv.locationId)" $checkinRule
  "Rule created: $($r.name)  id $($r.id)  (pause $BootDelay s, Home key $(if ($NoHomeKey) { 'off' } else { 'on' }))"
  'From now on, when the TV checks in while Skylight was the last thing on screen, SmartThings opens Skylight.'
}
if ($Execute) {
  # "checkin" or "poweron" finds the rule by name, so no id has to be typed.
  $byName = @{ checkin = 'Open Skylight when the TV checks in'; poweron = 'Open Skylight when the TV turns on' }
  if ($byName.ContainsKey($Execute)) {
    $found = (Call GET "/rules?locationId=$($tv.locationId)").items | Where-Object { $_.name -eq $byName[$Execute] } | Select-Object -First 1
    if (-not $found) { "No rule named '$($byName[$Execute])' exists; create it first."; exit 1 }
    $Execute = $found.id
  }
  $r = Call POST "/rules/execute/$Execute`?locationId=$($tv.locationId)" @{}
  "Executed rule $Execute : $($r | ConvertTo-Json -Compress -Depth 8)"
  'Look at the TV: did Skylight open (allow for the pauses inside the rule)?'
}
if ($Capability) {
  $c = Call GET "/capabilities/$Capability/1"
  "Capability $($c.id) v$($c.version)  status: $($c.status)"
  foreach ($a in $c.attributes.PSObject.Properties) {
    $schema = $a.Value.schema.properties.value
    $type = if ($schema.type) { $schema.type } else { ($schema | ConvertTo-Json -Compress -Depth 4) }
    $enum = if ($schema.enum) { ' one of: ' + ($schema.enum -join ', ') } else { '' }
    '  attribute {0}: {1}{2}' -f $a.Name, $type, $enum
  }
  foreach ($cmd in $c.commands.PSObject.Properties) {
    $args = @()
    foreach ($arg in $cmd.Value.arguments) {
      $s = $arg.schema
      $desc = if ($s.enum) { $s.type + ' one of: ' + ($s.enum -join ', ') } elseif ($s.type) { $s.type } else { ($s | ConvertTo-Json -Compress -Depth 4) }
      $args += '{0} ({1}{2})' -f $arg.name, $desc, $(if ($arg.optional) { ', optional' } else { '' })
    }
    '  command {0}({1})' -f $cmd.Name, ($args -join '; ')
  }
}
if ($ListRules) {
  (Call GET "/rules?locationId=$($tv.locationId)").items | ForEach-Object { "  $($_.name)  [$($_.id)]" }
}
if ($DeleteRule) {
  # "checkin" or "poweron" deletes every rule of that name, so no id has to be typed.
  $names = @{ checkin = 'Open Skylight when the TV checks in'; poweron = 'Open Skylight when the TV turns on' }
  $ids = if ($names.ContainsKey($DeleteRule)) {
    (Call GET "/rules?locationId=$($tv.locationId)").items | Where-Object { $_.name -eq $names[$DeleteRule] } | ForEach-Object { $_.id }
  } else { @($DeleteRule) }
  if (-not $ids) { "No rule to delete for '$DeleteRule'." }
  foreach ($id in $ids) {
    Call DELETE "/rules/$id`?locationId=$($tv.locationId)" | Out-Null
    "Rule $id deleted."
  }
}

# For pasting by hand into my.smartthings.com/advanced -> Rules (it wants only the actions array):
$rule.actions | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'skylight-boot-rule.json')
"The rule's actions were also written to tools\skylight-boot-rule.json for the Advanced Web App."
