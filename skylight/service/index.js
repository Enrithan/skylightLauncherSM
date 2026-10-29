// Skylight's background helper. The TV runs it as its own process, apart from the home screen's
// page, so it keeps working even if the TV freezes that page while a heavy app such as YouTube
// plays. Skylight tells it which app was just opened; it then asks the TV once a second whether
// that app is still running, and when the app has closed, brings Skylight back to the screen.
//
// The TV's own status service (port 8001, reachable only from the TV itself) reports for any app
// whether it is running and whether it is on screen. That works even for YouTube and TizenTube,
// which run inside a Samsung engine that never leaves the list of running apps. Exiting YouTube
// doesn't stop it either: it just leaves the screen. So leaving the screen is what counts, after
// checking that no other app took the screen instead. If the status service won't answer, the
// list of running apps is used instead.
//
// It also listens on 127.0.0.1:8130 for the same commands, and serves its recent log there, so
// the home screen's diagnostics panel can show what the helper saw.
'use strict';

var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');
var os = require('os');

var SKYLIGHT = 'skylightTV.Skylight';
var PORT = 8130;
var MAX_WATCH_MS = 3 * 60 * 60 * 1000;
var job = null; // { appId, shown, baseline, mode, seen, hiddenSince, busy, stops, started, timer }
var lines = [];
var startedAt = '';

// ---- Hardware Telemetry (CPU / RAM / Temp / GPU) ----------------------------
var lastCpu = null;

function sampleCpu() {
  // /proc/stat first (always readable on Linux), then os.cpus().
  try {
    var first = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    var idleP = first[3] + (first[4] || 0);
    var totalP = first.reduce(function (a, b) { return a + (b || 0); }, 0);
    var cores = 0;
    try { cores = (fs.readFileSync('/proc/stat', 'utf8').match(/^cpu\d+/gm) || []).length; } catch (e) {}
    return { idle: idleP, total: totalP, count: cores, model: 'ARM' };
  } catch (e) {}
  try {
    var cpus = os.cpus() || [];
    var idle = 0, total = 0;
    for (var i = 0; i < cpus.length; i++) {
      var t = cpus[i].times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    return { idle: idle, total: total, count: cpus.length, model: cpus[0] ? cpus[0].model : 'ARM' };
  } catch (e) {
    return null;
  }
}
lastCpu = sampleCpu();

function safe(fn, fallback) { try { var v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } }

function getSystemStats() {
  var curCpu = sampleCpu();
  var cpuPct = 0;
  if (curCpu && lastCpu && curCpu.total > lastCpu.total) {
    var dTotal = curCpu.total - lastCpu.total;
    var dIdle = curCpu.idle - lastCpu.idle;
    cpuPct = Math.round(Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)));
  }
  if (curCpu) lastCpu = curCpu;

  var meminfo = safe(function () { return fs.readFileSync('/proc/meminfo', 'utf8'); }, '');
  function memKb(name) { var m = meminfo.match(new RegExp(name + ':\\s+(\\d+)')); return m ? parseInt(m[1], 10) * 1024 : 0; }
  var totalMem = memKb('MemTotal') || safe(function () { return os.totalmem(); }, 0);
  var availMem = memKb('MemAvailable') || (memKb('MemFree') + memKb('Cached')) || safe(function () { return os.freemem(); }, 0);
  var usedMem = Math.max(0, totalMem - availMem);
  var memPct = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

  var tempC = null;
  for (var z = 0; z < 4 && tempC === null; z++) {
    var raw = safe(function () { return fs.readFileSync('/sys/class/thermal/thermal_zone' + z + '/temp', 'utf8').trim(); }, '');
    var n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) tempC = n > 1000 ? Math.round(n / 100) / 10 : n;
  }

  var gpuInfo = null;
  var gpuPaths = ['/sys/class/misc/mali0/device/utilization', '/sys/devices/platform/gpu/utilization',
    '/proc/mali/utilization', '/sys/kernel/gpu/gpu_busy', '/sys/class/devfreq/gpufreq/load'];
  for (var g = 0; g < gpuPaths.length && !gpuInfo; g++) {
    gpuInfo = safe(function () { return fs.readFileSync(gpuPaths[g], 'utf8').trim().slice(0, 60); }, null);
  }

  var load = safe(function () { return fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number); }, null) ||
    safe(function () { return os.loadavg(); }, [0, 0, 0]);
  var uptime = safe(function () { return parseFloat(fs.readFileSync('/proc/uptime', 'utf8')); }, 0) ||
    safe(function () { return os.uptime(); }, 0);
  var procMem = safe(function () { return Math.round(process.memoryUsage().rss / 1048576); }, 0);

  return {
    cpuPercent: cpuPct,
    cpuCores: curCpu ? curCpu.count : 0,
    ramUsedMB: Math.round(usedMem / 1048576),
    ramTotalMB: Math.round(totalMem / 1048576),
    ramFreeMB: Math.round(availMem / 1048576),
    ramPercent: memPct,
    loadAvg: load,
    tempC: tempC,
    gpuInfo: gpuInfo,
    helperRamMB: procMem,
    uptimeMin: Math.round(uptime / 60)
  };
}

// ---- Deep Process & Memory Telemetry -----------------------------------------
var procPrevCpu = {};
var cachedProcsResult = null;
var cachedProcsTime = 0;

function getProcessStats(done) {
  var now = Date.now();
  if (cachedProcsResult && now - cachedProcsTime < 2500) {
    done(cachedProcsResult);
    return;
  }

  var procs = [];
  var curCpuMap = {};

  try {
    var entries = fs.readdirSync('/proc');
    for (var i = 0; i < entries.length; i++) {
      var pid = parseInt(entries[i], 10);
      if (isNaN(pid)) continue;
      try {
        var status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
        var nameMatch = status.match(/^Name:\s*(.+)$/m);
        var rssMatch = status.match(/^VmRSS:\s*(\d+)\s*kB/m);
        var vmsMatch = status.match(/^VmSize:\s*(\d+)\s*kB/m);
        var stateMatch = status.match(/^State:\s*(\S+)/m);
        var thMatch = status.match(/^Threads:\s*(\d+)/m);

        var name = (nameMatch && nameMatch[1].trim()) || '';
        var rssKb = (rssMatch && parseInt(rssMatch[1], 10)) || 0;
        var vmsKb = (vmsMatch && parseInt(vmsMatch[1], 10)) || 0;
        var threads = (thMatch && parseInt(thMatch[1], 10)) || 1;

        var cpuPct = 0;
        if (rssKb > 0 || vmsKb > 0) {
          try {
            var statRaw = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
            var lastParen = statRaw.lastIndexOf(')');
            if (lastParen > -1) {
              var parts = statRaw.slice(lastParen + 2).trim().split(/\s+/);
              var utime = parseInt(parts[11], 10) || 0;
              var stime = parseInt(parts[12], 10) || 0;
              var totalTicks = utime + stime;
              curCpuMap[pid] = { total: totalTicks, time: now };
              if (procPrevCpu[pid]) {
                var dTicks = totalTicks - procPrevCpu[pid].total;
                var dMs = now - procPrevCpu[pid].time;
                if (dMs > 0 && dTicks >= 0) {
                  cpuPct = Math.round((dTicks / (dMs / 1000 * 100)) * 100);
                }
              }
            }
          } catch (e) {}
        }

        var cmdline = '';
        if (vmsKb > 0) {
          try {
            cmdline = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ').trim();
          } catch (e) {}
        }

        if (rssKb > 256 || cpuPct > 0 || (vmsKb > 0 && name)) {
          procs.push({
            pid: pid,
            name: name,
            cmd: cmdline.slice(0, 140) || name,
            cmdline: cmdline.slice(0, 140) || name,
            rssMB: Math.round(rssKb / 1024),
            vmsMB: Math.round(vmsKb / 1024),
            threads: threads,
            cpuPercent: Math.min(100, cpuPct),
            state: (stateMatch && stateMatch[1]) || '?'
          });
        }
      } catch (e) {}
    }
  } catch (err) {}

  procPrevCpu = curCpuMap;

  var meminfo = {};
  try {
    var rawMem = fs.readFileSync('/proc/meminfo', 'utf8');
    var mLines = rawMem.split('\n');
    for (var m = 0; m < mLines.length; m++) {
      var p = mLines[m].split(':');
      if (p.length === 2) {
        var k = p[0].trim();
        var v = parseInt(p[1].trim(), 10);
        if (!isNaN(v)) meminfo[k] = Math.round(v / 1024);
      }
    }
  } catch (e) {}

  procs.sort(function (a, b) { return b.rssMB - a.rssMB; });

  var finish = function (tizenApps) {
    cachedProcsResult = {
      ok: true,
      totalProcesses: procs.length,
      meminfo: meminfo,
      tizenApps: tizenApps || [],
      topProcesses: procs.slice(0, 50)
    };
    cachedProcsTime = Date.now();
    done(cachedProcsResult);
  };

  try {
    tizen.application.getAppsContext(function (list) {
      var tizenApps = list.map(function (c) { return { appId: c.appId, contextId: c.id }; });
      finish(tizenApps);
    }, function () {
      finish([]);
    });
  } catch (e) {
    finish([]);
  }
}

function killProcess(pid, done) {
  var p = parseInt(pid, 10);
  if (isNaN(p) || p <= 1) { done({ ok: false, error: 'invalid pid' }); return; }
  try {
    process.kill(p, 'SIGTERM');
    log('sent SIGTERM to pid ' + p);
    setTimeout(function () {
      try { process.kill(p, 'SIGKILL'); } catch (e) {}
      done({ ok: true, killed: p });
    }, 300);
  } catch (err) {
    done({ ok: false, error: err.message });
  }
}

// ---- Calendar Integration ---------------------------------------------------
var DEFAULT_CALENDAR = '';
var calendarUrl = '';
var cachedEvents = [];
var CALENDAR_FILE = '/tmp/skylight_calendar_url.txt';
var PERSIST_CALENDAR = '/opt/usr/home/owner/content/skylight_calendar.txt';

try {
  calendarUrl = (fs.existsSync(PERSIST_CALENDAR) && fs.readFileSync(PERSIST_CALENDAR, 'utf8').trim()) ||
    (fs.existsSync(CALENDAR_FILE) && fs.readFileSync(CALENDAR_FILE, 'utf8').trim()) || DEFAULT_CALENDAR;
} catch (e) {
  calendarUrl = DEFAULT_CALENDAR;
}
if (!calendarUrl) calendarUrl = DEFAULT_CALENDAR;

function parseIcsDate(raw) {
  var clean = raw.split(':').pop().trim();
  if (clean.length === 8) {
    var y = parseInt(clean.slice(0, 4), 10);
    var m = parseInt(clean.slice(4, 6), 10) - 1;
    var d = parseInt(clean.slice(6, 8), 10);
    return { date: new Date(y, m, d), allDay: true };
  }
  if (clean.indexOf('T') > 0) {
    var dPart = clean.slice(0, 8);
    var tPart = clean.slice(9, 15);
    var y = parseInt(dPart.slice(0, 4), 10);
    var m = parseInt(dPart.slice(4, 6), 10) - 1;
    var d = parseInt(dPart.slice(6, 8), 10);
    var hh = parseInt(tPart.slice(0, 2), 10);
    var mm = parseInt(tPart.slice(2, 4), 10);
    var dt = clean.indexOf('Z') > -1 ? new Date(Date.UTC(y, m, d, hh, mm)) : new Date(y, m, d, hh, mm);
    return { date: dt, allDay: false };
  }
  return null;
}

function formatRelativeTime(dt, allDay) {
  var now = new Date();
  var h = dt.getHours();
  var m = dt.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  var h12 = h % 12 || 12;
  var timeStr = allDay ? 'All day' : (h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm);

  var isToday = dt.toDateString() === now.toDateString();
  var tomorrow = new Date(now.getTime() + 86400000);
  var isTomorrow = dt.toDateString() === tomorrow.toDateString();

  var diffDays = Math.round((dt.getTime() - now.getTime()) / 86400000);

  if (isToday) return 'Today, ' + timeStr;
  if (isTomorrow) return 'Tomorrow, ' + timeStr;

  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (diffDays >= 0 && diffDays < 7) {
    return days[dt.getDay()] + ', ' + timeStr;
  }
  return months[dt.getMonth()] + ' ' + dt.getDate() + ', ' + timeStr;
}

function parseIcs(icsText) {
  var unfolded = icsText.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  var lines = unfolded.split(/\r?\n/);
  var cur = null;
  var now = new Date();
  var nowTs = now.getTime();
  var horizon = nowTs + 60 * 86400 * 1000;
  var allUpcoming = [];

  var dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line === 'BEGIN:VEVENT') {
      cur = { summary: '', parsedStart: null, rrule: null };
    } else if (line === 'END:VEVENT' && cur) {
      if (cur.summary && cur.parsedStart && cur.parsedStart.date) {
        var origDate = cur.parsedStart.date;
        var allDay = cur.parsedStart.allDay;

        if (cur.rrule && cur.rrule.indexOf('FREQ=WEEKLY') > -1) {
          var byDays = [];
          var m = cur.rrule.match(/BYDAY=([A-Z,]+)/);
          if (m) {
            byDays = m[1].split(',').map(function (d) { return dayMap[d]; }).filter(function (d) { return typeof d === 'number'; });
          } else {
            byDays = [origDate.getDay()];
          }

          for (var dayOffset = 0; dayOffset < 28; dayOffset++) {
            var check = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, origDate.getHours(), origDate.getMinutes());
            if (byDays.indexOf(check.getDay()) > -1) {
              if (check.getTime() >= nowTs - 7200000 && check.getTime() <= horizon) {
                allUpcoming.push({
                  title: cur.summary,
                  time: formatRelativeTime(check, allDay),
                  timestamp: check.getTime()
                });
              }
            }
          }
        } else {
          var startTs = origDate.getTime();
          if (startTs >= nowTs - 7200000 && startTs <= horizon) {
            allUpcoming.push({
              title: cur.summary,
              time: formatRelativeTime(origDate, allDay),
              timestamp: startTs
            });
          }
        }
      }
      cur = null;
    } else if (cur) {
      if (line.indexOf('SUMMARY') === 0) {
        var idx = line.indexOf(':');
        if (idx > -1) cur.summary = line.slice(idx + 1).trim();
      } else if (line.indexOf('DTSTART') === 0) {
        cur.parsedStart = parseIcsDate(line);
      } else if (line.indexOf('RRULE') === 0) {
        cur.rrule = line;
      }
    }
  }

  var seen = {};
  var filtered = [];
  allUpcoming.sort(function (a, b) { return a.timestamp - b.timestamp; });
  for (var j = 0; j < allUpcoming.length; j++) {
    var key = allUpcoming[j].title + '|' + allUpcoming[j].timestamp;
    if (!seen[key]) {
      seen[key] = true;
      filtered.push(allUpcoming[j]);
    }
  }
  return filtered.slice(0, 4);
}

function fetchCalendar() {
  if (!calendarUrl) return;
  var client = calendarUrl.indexOf('https:') === 0 ? https : http;
  try {
    var req = client.get(calendarUrl, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        calendarUrl = res.headers.location;
        fetchCalendar();
        return;
      }
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        cachedEvents = parseIcs(body);
        log('fetched calendar: ' + cachedEvents.length + ' upcoming events');
      });
    });
    req.setTimeout(8000, function () { req.abort(); log('calendar fetch timeout'); });
    req.on('error', function (e) { log('calendar fetch error: ' + e.message); });
  } catch (err) {
    log('calendar fetch threw: ' + err.message);
  }
}

if (calendarUrl) {
  setTimeout(fetchCalendar, 3000);
}
setInterval(fetchCalendar, 15 * 60 * 1000);

// ---- Weather & Location (Zero API Key) -------------------------------------
var DEFAULT_LOCATION = '';
var LOCATION_FILE = '/tmp/skylight_location.txt';
var PERSIST_LOCATION = '/opt/usr/home/owner/content/skylight_location.txt';
var locationQuery = '';
var cachedWeather = null;

try {
  locationQuery = (fs.existsSync(PERSIST_LOCATION) && fs.readFileSync(PERSIST_LOCATION, 'utf8').trim()) ||
    (fs.existsSync(LOCATION_FILE) && fs.readFileSync(LOCATION_FILE, 'utf8').trim()) || DEFAULT_LOCATION;
} catch (e) {
  locationQuery = DEFAULT_LOCATION;
}
if (!locationQuery) locationQuery = DEFAULT_LOCATION;

function fetchWeather() {
  if (!locationQuery) {
    try {
      var ipReq = https.get('https://ipwho.is/', function (res) {
        var ipBody = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { ipBody += c; });
        res.on('end', function () {
          try {
            var data = JSON.parse(ipBody);
            if (data && data.success && data.latitude && data.longitude) {
              locationQuery = data.latitude + ',' + data.longitude;
              try { fs.writeFileSync(LOCATION_FILE, locationQuery); } catch (e) {}
              log('auto-detected location via ipwho.is: ' + (data.city || '') + ' (' + locationQuery + ')');
              queryWttr(locationQuery, data.city);
              return;
            }
          } catch (e) {}
          queryWttr('');
        });
      });
      ipReq.setTimeout(5000, function () { ipReq.abort(); queryWttr(''); });
      ipReq.on('error', function () { queryWttr(''); });
    } catch (e) {
      queryWttr('');
    }
  } else {
    queryWttr(locationQuery);
  }
}

function queryWttr(loc, defaultCity) {
  var targetPath = loc ? '/' + encodeURIComponent(loc) + '?format=j1' : '/?format=j1';
  var options = {
    host: 'wttr.in',
    port: 443,
    path: targetPath,
    headers: { 'User-Agent': 'curl/7.68.0' }
  };
  try {
    var req = https.get(options, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return;
      }
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        try {
          var j = JSON.parse(body);
          var cur = j.current_condition && j.current_condition[0];
          var w = j.weather && j.weather[0];
          var astro = w && w.astronomy && w.astronomy[0];
          var area = j.nearest_area && j.nearest_area[0];
          var cityName = (area && area.areaName && area.areaName[0] && area.areaName[0].value) || defaultCity || '';

          if (cur) {
            cachedWeather = {
              tempC: parseInt(cur.temp_C, 10),
              tempF: parseInt(cur.temp_F, 10),
              desc: (cur.weatherDesc && cur.weatherDesc[0] && cur.weatherDesc[0].value.trim()) || 'Clear',
              sunrise: (astro && astro.sunrise) || '6:00 AM',
              sunset: (astro && astro.sunset) || '6:00 PM',
              city: cityName,
              updatedAt: Date.now()
            };
            log('fetched weather: ' + cachedWeather.tempC + 'C, ' + cachedWeather.desc + ' (' + (cachedWeather.city || 'auto') + ')');
          }
        } catch (err) {
          log('weather parse error: ' + err.message);
        }
      });
    });
    req.setTimeout(8000, function () { req.abort(); log('weather fetch timeout'); });
    req.on('error', function (e) { log('weather fetch error: ' + e.message); });
  } catch (err) {
    log('weather fetch threw: ' + err.message);
  }
}

setTimeout(fetchWeather, 4000);
setInterval(fetchWeather, 30 * 60 * 1000);

function log(text) {
  var t = new Date();
  var two = function (n) { return (n < 10 ? '0' : '') + n; };
  lines.push(two(t.getHours()) + ':' + two(t.getMinutes()) + ':' + two(t.getSeconds()) + '  helper: ' + text);
  if (lines.length > 80) lines.shift();
  console.log('[SkylightWatch] ' + text);
}

// ---- Asking the TV ---------------------------------------------------------------------------

function get(port, path, done) {
  var finished = false;
  function finish(status, body) { if (!finished) { finished = true; done(status, body); } }
  var req = http.get({ host: '127.0.0.1', port: port, path: path, headers: { 'Cache-Control': 'no-cache' } }, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () { finish(res.statusCode, body); });
  });
  req.setTimeout(1500, function () { req.abort(); finish(0, ''); });
  req.on('error', function (e) { finish(0, String(e && e.message)); });
}

// The TV's own status for one app: { running, visible }, or null if it won't say.
function appState(appId, done) {
  get(8001, '/api/v2/applications/' + appId, function (status, body) {
    try {
      var info = JSON.parse(body);
      done(status === 200 && typeof info.running === 'boolean' ? { running: info.running, visible: !!info.visible } : null);
    } catch (e) {
      done(null);
    }
  });
}

function runningApps(done) {
  try {
    tizen.application.getAppsContext(function (list) {
      done(list.map(function (c) { return c.appId; }));
    }, function (e) { log('getAppsContext failed: ' + e.name); done(null); });
  } catch (e) {
    log('getAppsContext threw: ' + e.name);
    done(null);
  }
}

function del(port, path, done) {
  var finished = false;
  function finish(status, body) { if (!finished) { finished = true; done(status, body); } }
  try {
    var req = http.request({ host: '127.0.0.1', port: port, path: path, method: 'DELETE', headers: { 'Cache-Control': 'no-cache' } }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () { finish(res.statusCode, body); });
    });
    req.setTimeout(1500, function () { req.abort(); finish(0, ''); });
    req.on('error', function (e) { finish(0, String(e && e.message)); });
    req.end();
  } catch (err) {
    finish(0, String(err && err.message));
  }
}

var CLEAN_CANDIDATES = [
  'org.tizen.netflix-app',
  '9Ur5IzDKqV.TizenYouTube',
  'org.tizen.primevideo',
  'MCmYXNxgcu.DisneyPlus',
  'com.samsung.tv.aria-video',
  'SKvHIMBcln.CraveTV',
  'rJyOSqC6Up.PPlusIntl',
  'rJeHak5zRg.Spotify',
  'mMABuBMnjq.TSNGO',
  'org.tizen.browser',
  'com.samsung.tv.gallery',
  '22emanual5.emanual',
  'yL49PNFmjW.PromotionApp',
  '2022ePop02.SmartTV',
  'kleboAnim1.Main',
  'AQKO41xyKP.AmazonAlexa',
  'HEPsqFNie0.tvplusstandalone',
  'com.samsung.tv.store',
  'com.samsung.tv.sboard-app',
  'com.samsung.tv.home.media',
  'com.samsung.tv.home.art',
  'org.tizen.art-app',
  'com.samsung.tv.targeted-ad-service',
  'com.samsung.tv.acr',
  'org.tizen.content-tiles-provider',
  'com.samsung.tv.aisound-app',
  'com.samsung.tv.action-planner-service',
  'com.samsung.tv.smartthingsfind-daemon',
  'com.samsung.tv.bixbycapsuleviewer'
];

function cleanupResidentApps(done) {
  var before = getSystemStats();
  var closed = [];

  try {
    tizen.application.getAppsContext(function (list) {
      var runningMap = {};
      list.forEach(function (ctx) { runningMap[ctx.appId] = ctx.id; });

      var targets = CLEAN_CANDIDATES.filter(function (id) { return !!runningMap[id]; });
      log('RAM cleanup: found ' + targets.length + ' bloatware/resident apps in RAM');

      var idx = 0;
      function next() {
        if (idx >= targets.length) {
          setTimeout(function () {
            var after = getSystemStats();
            var freed = Math.max(0, before.ramUsedMB - after.ramUsedMB);
            log('cleanup complete: closed ' + closed.length + ' apps, freed ' + freed + ' MB RAM');
            done({
              ok: true,
              closedApps: closed,
              ramFreedMB: freed,
              beforeUsedMB: before.ramUsedMB,
              afterUsedMB: after.ramUsedMB,
              ramTotalMB: after.ramTotalMB,
              ramFreeMB: after.ramFreeMB,
              ramPercent: after.ramPercent
            });
          }, 800);
          return;
        }

        var appId = targets[idx++];
        var ctxId = runningMap[appId];

        try {
          tizen.application.kill(ctxId, function () {
            closed.push(appId);
            log('tizen.application.kill succeeded for ' + appId);
          }, function (e) {
            log('tizen.application.kill failed for ' + appId + ': ' + e.message);
          });
        } catch (e) {}

        del(8001, '/api/v2/applications/' + appId, function (st) {
          if ((st === 200 || st === 204) && closed.indexOf(appId) === -1) {
            closed.push(appId);
            log('port 8001 DELETE succeeded for ' + appId);
          }
          setTimeout(next, 150);
        });
      }

      if (targets.length === 0) {
        checkFallbackList();
      } else {
        next();
      }
    }, function () {
      checkFallbackList();
    });
  } catch (err) {
    checkFallbackList();
  }

  function checkFallbackList() {
    var idx = 0;
    function nextFallback() {
      if (idx >= CLEAN_CANDIDATES.length) {
        setTimeout(function () {
          var after = getSystemStats();
          var freed = Math.max(0, before.ramUsedMB - after.ramUsedMB);
          done({
            ok: true,
            closedApps: closed,
            ramFreedMB: freed,
            beforeUsedMB: before.ramUsedMB,
            afterUsedMB: after.ramUsedMB,
            ramTotalMB: after.ramTotalMB,
            ramFreeMB: after.ramFreeMB,
            ramPercent: after.ramPercent
          });
        }, 600);
        return;
      }
      var appId = CLEAN_CANDIDATES[idx++];
      del(8001, '/api/v2/applications/' + appId, function (st) {
        if (st === 200 || st === 204) closed.push(appId);
        setTimeout(nextFallback, 100);
      });
    }
    nextFallback();
  }
}

// ---- Watching --------------------------------------------------------------------------------

function stop(reason) {
  if (job) { clearInterval(job.timer); if (reason) log('stopped watching ' + job.appId + ': ' + reason); }
  job = null;
}

function start(appId, shown) {
  stop('replaced');
  job = { appId: appId, shown: shown, seen: false, stops: 0, started: Date.now(), timer: null };
  log('watching ' + appId);
  job.timer = setInterval(check, 3500);
}

function check() {
  if (!job) return;
  var age = Date.now() - job.started;
  if (age > MAX_WATCH_MS) { stop('gave up after three hours'); return; }

  appState(job.appId, function (state) {
    if (!job) return;
    if (!state) {
      if (age > 15000 && !job.seen) stop(job.appId + ' did not answer');
      return;
    }
    if (state.running && state.visible) {
      if (!job.seen) { job.seen = true; log(job.appId + ' is on screen'); }
      job.stops = 0;
      return;
    }
    if (!job.seen) {
      if (age > 30000) stop(job.appId + ' never came on screen');
      return;
    }
    var left = job.appId;
    stop();
    log('bringing Skylight back; ' + left + ' left the screen');
    launchSkylight();
  });
}

function launchSkylight(onLaunched) {
  try {
    tizen.application.launch(SKYLIGHT, function () { log('Skylight launched'); if (onLaunched) onLaunched(); },
      function (e) { log('launch failed: ' + e.name + ' ' + e.message); });
  } catch (e) {
    log('launch threw: ' + e.name);
  }
}

// ---- Standing guard: event-driven (zero background polling while Skylight is on screen) -------

var guard = { shown: [], pausedUntil: 0, busy: false, force: false,
  timer: null, bootDone: false, since: Date.now(), lastTick: 0 };

function guardTick() {
  var now = Date.now();
  var woke = guard.lastTick && (now - guard.lastTick > 25000);
  guard.lastTick = now;

  if (woke) {
    guard.since = now;
    guard.bootDone = false;
    guard.force = true;
    log('the TV woke up');
  }

  // Only check when explicitly notified via /away or once after boot/wake
  if (!guard.force && guard.bootDone) return;
  if (guard.busy || job || now < guard.pausedUntil) {
    guard.force = false;
    return;
  }

  guard.force = false;
  guard.busy = true;
  appState(SKYLIGHT, function (sky) {
    if (sky && sky.visible) { guard.busy = false; guard.bootDone = true; return; }
    // Only take over Samsung's own home screen; never an app opened another way
    // (e.g. from the SmartThings phone app). A handful of requests, once per event.
    homeVisible(function (isHome) {
      guard.busy = false;
      guard.bootDone = true;
      if (!isHome || job || Date.now() < guard.pausedUntil) return;
      log('Samsung home is up; bringing Skylight back');
      launchSkylight();
    });
  });
}

var HOME_CANDIDATES = ['com.samsung.tv.coba.newhome', 'com.samsung.tv.home', 'com.samsung.tv.homescreen',
  'org.tizen.homescreen', 'com.samsung.tv.smarthub', 'com.samsung.tv.home.sidebar', 'com.samsung.tv.csfs'];

function homeVisible(done) {
  var pending = HOME_CANDIDATES.length;
  var found = false;
  HOME_CANDIDATES.forEach(function (id) {
    appState(id, function (state) {
      if (state && state.running && state.visible) found = true;
      if (--pending === 0) done(found);
    });
  });
}

// ---- Commands --------------------------------------------------------------------------------

function handle(cmd, params) {
  if (cmd === 'watch' && params.app) {
    if (params.shown) guard.shown = params.shown.split(',');
    start(params.app, (params.shown || '').split(','));
  } else if (cmd === 'stop') {
    stop('Skylight is back on screen');
  } else if (cmd === 'guard') {
    if (params.shown) guard.shown = params.shown.split(',');
    log('standing guard for ' + guard.shown.length + ' apps');
  } else if (cmd === 'pause') {
    var seconds = parseInt(params.seconds, 10) || 180;
    guard.pausedUntil = Date.now() + seconds * 1000;
    log('leaving Samsung’s screen alone for ' + seconds + ' s');
  } else if (cmd === 'away') {
    // Skylight just lost the screen without opening anything: look right now.
    guard.force = true;
    guardTick();
  } else {
    log('unknown command: ' + cmd);
  }
}

function readRequest() {
  var out = {};
  try {
    var data = tizen.application.getCurrentApplication().getRequestedAppControl().appControl.data;
    data.forEach(function (item) { out[item.key] = item.value[0]; });
  } catch (e) {
    log('no request data: ' + e.name);
  }
  return out;
}

var DASHBOARD_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Freestyle resources</title><style>' +
  'body{font-family:-apple-system,Segoe UI,sans-serif;background:#0b0f19;color:#e5e7eb;margin:0;padding:20px}' +
  'h1{font-size:20px;color:#60a5fa;margin:0}.header{display:flex;align-items:center;justify-content:space-between;max-width:980px;margin-bottom:6px}' +
  '.btn{background:#059669;border:none;color:#fff;padding:8px 16px;border-radius:8px;font-weight:600;font-size:13px;cursor:pointer;transition:background .2s}' +
  '.btn:hover{background:#10b981}.sub{color:#6b7280;font-size:13px;margin-bottom:18px}' +
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;max-width:980px}' +
  '.card{background:#151d30;border-radius:14px;padding:16px}.k{font-size:13px;color:#9ca3af}' +
  '.v{font-size:30px;font-weight:700;margin:4px 0 10px}.bar{height:10px;background:#1f2937;border-radius:6px;overflow:hidden}' +
  '.fill{height:100%;width:0;background:#22c55e;transition:width .4s}' +
  'canvas{width:100%;height:60px;margin-top:10px}.small{font-size:12px;color:#6b7280;margin-top:6px}' +
  '</style></head><body>' +
  '<div class="header"><h1>Samsung Freestyle: live resources</h1>' +
  '<div><button class="btn" onclick="cleanRam()">🧹 Clean RAM Now</button><span id="clnSt" style="margin-left:10px;font-size:13px;color:#34d399"></span></div></div>' +
  '<div class="sub" id="st">connecting...</div>' +
  '<div class="grid">' +
  '<div class="card"><div class="k">CPU</div><div class="v" id="cpu">-</div><div class="bar"><div class="fill" id="cpuB"></div></div><canvas id="cpuC" width="300" height="60"></canvas><div class="small" id="cpuS"></div></div>' +
  '<div class="card"><div class="k">RAM</div><div class="v" id="ram">-</div><div class="bar"><div class="fill" id="ramB"></div></div><canvas id="ramC" width="300" height="60"></canvas><div class="small" id="ramS"></div></div>' +
  '<div class="card"><div class="k">Temperature</div><div class="v" id="tmp">-</div><div class="bar"><div class="fill" id="tmpB"></div></div><div class="small">SoC thermal zone</div></div>' +
  '<div class="card"><div class="k">GPU / Load</div><div class="v" id="gpu">-</div><div class="small" id="ld"></div><div class="small" id="up"></div></div>' +
  '</div>' +
  '<div style="margin-top:20px;max-width:980px">' +
  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
  '<h2 style="font-size:16px;color:#60a5fa;margin:0">Active Processes (sorted by RAM)</h2>' +
  '<span id="procCount" style="font-size:12px;color:#9ca3af"></span>' +
  '</div>' +
  '<div style="overflow-x:auto;background:#151d30;border-radius:12px;border:1px solid #1f2937;max-height:480px;overflow-y:auto">' +
  '<table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">' +
  '<thead><tr style="color:#9ca3af;border-bottom:1px solid #1f2937;background:#0d1322;position:sticky;top:0">' +
  '<th style="padding:8px 10px">PID</th><th style="padding:8px 10px">Process Name &amp; Command</th><th style="padding:8px 10px">RAM</th>' +
  '<th style="padding:8px 10px">CPU%</th><th style="padding:8px 10px">Threads</th><th style="padding:8px 10px">State</th><th style="padding:8px 10px">Action</th>' +
  '</tr></thead><tbody id="procTable"></tbody></table></div></div>' +
  '<script>' +
  'var H={cpu:[],ram:[]};function col(p){return p<60?"#22c55e":p<85?"#f59e0b":"#ef4444"}' +
  'function draw(id,a){var c=document.getElementById(id),x=c.getContext("2d");x.clearRect(0,0,300,60);x.beginPath();' +
  'a.forEach(function(v,i){var X=i*(300/59),Y=58-v*0.56;i?x.lineTo(X,Y):x.moveTo(X,Y)});x.strokeStyle="#60a5fa";x.lineWidth=2;x.stroke()}' +
  'function set(id,p){var b=document.getElementById(id);b.style.width=p+"%";b.style.background=col(p)}' +
  'function cleanRam(){var s=document.getElementById("clnSt");s.textContent="Cleaning resident apps...";' +
  'fetch("/cleanup",{method:"POST"}).then(function(r){return r.json()}).then(function(d){' +
  's.textContent="Cleaned! Closed: "+(d.closedApps?d.closedApps.length:0)+", Freed: "+d.ramFreedMB+" MB";' +
  'setTimeout(tick,400);setTimeout(tickProcs,600);}).catch(function(){s.textContent="Cleanup failed"});}' +
  'function tickProcs(){fetch("/procs").then(function(r){return r.json()}).then(function(d){' +
  'if(!d||!d.topProcesses)return;document.getElementById("procCount").textContent="Total: "+d.totalProcesses+" processes (top "+d.topProcesses.length+")";' +
  'var tb=document.getElementById("procTable");tb.innerHTML="";' +
  'd.topProcesses.forEach(function(p){' +
  'var tr=document.createElement("tr");tr.style.borderBottom="1px solid #1a2234";' +
  'var ramCol=p.rssMB>60?"#ef4444":p.rssMB>25?"#f59e0b":"#34d399";' +
  'tr.innerHTML="<td style=\\"padding:6px 10px;font-family:monospace;color:#60a5fa\\">"+p.pid+"</td>"+' +
  '"<td style=\\"padding:6px 10px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\\" title=\\""+p.cmd+"\\"><b>"+p.name+"</b> <span style=\\"color:#6b7280;font-size:11px\\">"+p.cmd+"</span></td>"+' +
  '"<td style=\\"padding:6px 10px;font-weight:700;color:"+ramCol+"\\">"+p.rssMB+" MB</td>"+' +
  '"<td style=\\"padding:6px 10px\\">"+(p.cpuPercent||0)+"%</td>"+' +
  '"<td style=\\"padding:6px 10px\\">"+p.threads+"</td>"+' +
  '"<td style=\\"padding:6px 10px\\">"+p.state+"</td>"+' +
  '"<td style=\\"padding:6px 10px\\"><button style=\\"background:#dc2626;color:#fff;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px\\" onclick=\\"killProc("+p.pid+")\\">Stop</button></td>";' +
  'tb.appendChild(tr);});}).catch(function(){});}' +
  'function killProc(pid){if(!confirm("Stop process PID "+pid+"?"))return;' +
  'fetch("/kill_proc?pid="+pid,{method:"POST"}).then(function(r){return r.json()}).then(function(d){' +
  'alert(d.ok?"Stopped PID "+pid:"Error: "+d.error);setTimeout(tickProcs,400);});}' +
  'function tick(){fetch("/stats",{cache:"no-store"}).then(function(r){return r.json()}).then(function(s){' +
  'if(s.error){document.getElementById("st").textContent="error: "+s.error;return}' +
  'document.getElementById("st").textContent="updated "+new Date().toLocaleTimeString()+" (every 2 s)";' +
  'document.getElementById("cpu").textContent=s.cpuPercent+"%";set("cpuB",s.cpuPercent);' +
  'document.getElementById("cpuS").textContent=s.cpuCores+" cores";' +
  'document.getElementById("ram").textContent=s.ramPercent+"%";set("ramB",s.ramPercent);' +
  'document.getElementById("ramS").textContent=s.ramUsedMB+" / "+s.ramTotalMB+" MB used, "+s.ramFreeMB+" MB available (helper "+s.helperRamMB+" MB)";' +
  'var t=s.tempC;document.getElementById("tmp").textContent=t==null?"n/a":t+" \u00b0C";set("tmpB",t==null?0:Math.min(100,t));' +
  'document.getElementById("gpu").textContent=s.gpuInfo||"not exposed";' +
  'document.getElementById("ld").textContent="Load avg: "+(s.loadAvg||[]).join(" / ");' +
  'document.getElementById("up").textContent="Uptime: "+s.uptimeMin+" min";' +
  'H.cpu.push(s.cpuPercent);H.ram.push(s.ramPercent);if(H.cpu.length>60){H.cpu.shift();H.ram.shift()}draw("cpuC",H.cpu);draw("ramC",H.ram)' +
  '}).catch(function(){document.getElementById("st").textContent="projector not reachable"})}' +
  'tick();tickProcs();setInterval(tick,2000);setInterval(tickProcs,3000);</script></body></html>';

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  var path = parsed.pathname.replace(/^\/+/, '');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (path === 'log') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ watching: job ? job.appId : '', paused: Date.now() < guard.pausedUntil, since: startedAt, lines: lines }));
    return;
  }
  if (path === 'stats') {
    res.setHeader('Content-Type', 'application/json');
    var stats;
    try { stats = getSystemStats(); } catch (e) { stats = { error: String(e && e.message || e) }; }
    res.end(JSON.stringify(stats));
    return;
  }
  if (path === 'procs' || path === 'processes') {
    getProcessStats(function (info) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(info));
    });
    return;
  }
  if (path === 'api8001') {
    var p8 = (parsed.query && parsed.query.p) || '/api/v2/applications/';
    var m8 = (parsed.query && parsed.query.m) || 'GET';
    if (m8 === 'DELETE') {
      del(8001, p8, function (st, b) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: st, body: b }));
      });
    } else {
      get(8001, p8, function (st, b) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: st, body: b }));
      });
    }
    return;
  }
  if (path === 'kill_proc') {
    var pidToKill = (parsed.query && parsed.query.pid) || '';
    var doKill = function (p) {
      killProcess(p, function (r) {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(r));
      });
    };
    if (req.method === 'POST') {
      var kBody = '';
      req.on('data', function (c) { kBody += c; });
      req.on('end', function () {
        var m = kBody.match(/(?:^|&)pid=([^&]*)/);
        if (m) pidToKill = decodeURIComponent(m[1]);
        doKill(pidToKill);
      });
      return;
    }
    doKill(pidToKill);
    return;
  }
  if (path === 'cleanup') {
    cleanupResidentApps(function (result) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    });
    return;
  }
  if (path === 'dashboard') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(DASHBOARD_HTML);
    return;
  }
  if (path === 'calendar') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ configured: !!calendarUrl, events: cachedEvents }));
    return;
  }
  if (path === 'weather') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, weather: cachedWeather, location: locationQuery }));
    return;
  }
  if (path === 'refresh_weather') {
    fetchWeather();
    setTimeout(function () {
      res.writeHead(302, { Location: '/?refreshed=1' });
      res.end();
    }, 1200);
    return;
  }
  if (path === 'save_location') {
    var updateLoc = function (val) {
      if (val) {
        val = val.trim();
        var gMap = val.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || val.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
        var coords = val.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
        if (gMap) {
          locationQuery = gMap[1] + ',' + gMap[2];
        } else if (coords) {
          locationQuery = coords[1] + ',' + coords[2];
        } else {
          locationQuery = val;
        }
        try { fs.writeFileSync(LOCATION_FILE, locationQuery); } catch (e) {}
        try { fs.writeFileSync(PERSIST_LOCATION, locationQuery); } catch (e) {}
        log('saved location: ' + locationQuery);
        fetchWeather();
      }
    };
    if (req.method === 'POST') {
      var locBody = '';
      req.on('data', function (chunk) { locBody += chunk; });
      req.on('end', function () {
        var latMatch = locBody.match(/(?:^|&)lat=([^&]*)/);
        var lonMatch = locBody.match(/(?:^|&)lon=([^&]*)/);
        var cityMatch = locBody.match(/(?:^|&)(?:city|q|query)=([^&]*)/);
        if (latMatch && lonMatch) {
          var pLat = decodeURIComponent(latMatch[1]).trim();
          var pLon = decodeURIComponent(lonMatch[1]).trim();
          if (pLat && pLon) updateLoc(pLat + ',' + pLon);
        } else if (cityMatch) {
          updateLoc(decodeURIComponent(cityMatch[1].replace(/\+/g, ' ')));
        }
        res.writeHead(302, { Location: '/?saved=1' });
        res.end();
      });
      return;
    }
    if (parsed.query && (parsed.query.city || parsed.query.lat || parsed.query.q)) {
      if (parsed.query.lat && parsed.query.lon) updateLoc(parsed.query.lat + ',' + parsed.query.lon);
      else if (parsed.query.city) updateLoc(parsed.query.city);
      else if (parsed.query.q) updateLoc(parsed.query.q);
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, weather: cachedWeather, location: locationQuery }));
    return;
  }
  if (path === 'save_calendar') {
    var newUrl = (parsed.query && parsed.query.url) || '';
    if (req.method === 'POST') {
      var postBody = '';
      req.on('data', function (chunk) { postBody += chunk; });
      req.on('end', function () {
        var match = postBody.match(/(?:^|&)url=([^&]*)/);
        if (match) newUrl = decodeURIComponent(match[1].replace(/\+/g, ' '));
        if (newUrl) {
          calendarUrl = newUrl.trim();
          try { fs.writeFileSync(CALENDAR_FILE, calendarUrl); } catch (e) {}
          try { fs.writeFileSync(PERSIST_CALENDAR, calendarUrl); } catch (e) {}
          fetchCalendar();
        }
        res.writeHead(302, { Location: '/?cal_saved=1' });
        res.end();
      });
      return;
    }
    if (newUrl) {
      calendarUrl = newUrl.trim();
      try { fs.writeFileSync(CALENDAR_FILE, calendarUrl); } catch (e) {}
      try { fs.writeFileSync(PERSIST_CALENDAR, calendarUrl); } catch (e) {}
      fetchCalendar();
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, events: cachedEvents }));
    return;
  }
  if (path === '' || path === 'setup') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    var evHtml = cachedEvents.map(function (e) {
      return '<div class="ev"><span style="color:#60a5fa;font-weight:600">' + e.time + '</span><span>' + e.title + '</span></div>';
    }).join('');
    var weatherSummary = cachedWeather ? (cachedWeather.tempC + '°C, ' + cachedWeather.desc + ' · Sunrise ' + cachedWeather.sunrise + ', Sunset ' + cachedWeather.sunset + ' (' + (cachedWeather.city || 'Local') + ')') : 'Detecting...';

    var parsedLat = 0;
    var parsedLon = 0;
    if (locationQuery) {
      var mCoords = locationQuery.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (mCoords) {
        parsedLat = parseFloat(mCoords[1]);
        parsedLon = parseFloat(mCoords[2]);
      }
    }

    var bannerHtml = '';
    if (parsed.query && parsed.query.saved) {
      bannerHtml = '<div class="alert-success">✅ Location successfully saved! Projector weather updated.</div>';
    } else if (parsed.query && parsed.query.refreshed) {
      bannerHtml = '<div class="alert-success">🔄 Weather refreshed from live stations.</div>';
    } else if (parsed.query && parsed.query.cal_saved) {
      bannerHtml = '<div class="alert-success">📅 Calendar link saved and synced!</div>';
    }

    var html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Skylight Projector Setup</title>' +
      '<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>' +
      '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>' +
      '<style>' +
      '*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0f19;color:#f3f4f6;margin:0;padding:16px;line-height:1.5}' +
      '.container{max-width:580px;margin:0 auto}.card{background:#151d30;padding:24px;border-radius:18px;box-shadow:0 10px 25px rgba(0,0,0,0.5);margin-bottom:20px;border:1px solid #1f293d}' +
      'h1{font-size:22px;color:#60a5fa;margin:0 0 8px}p{font-size:14px;color:#9ca3af;margin:0 0 16px}' +
      '.btn{background:#2563eb;color:#fff;border:none;padding:12px 16px;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .2s}' +
      '.btn-green{background:#059669}.btn-green:hover{background:#10b981}.btn-gray{background:#374151}.btn-gray:hover{background:#4b5563}.btn-full{width:100%}' +
      'input[type=text],input[type=url]{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #374151;background:#0d1322;color:#fff;font-size:14px}' +
      'input[type=text]:focus,input[type=url]:focus{outline:none;border-color:#60a5fa}' +
      '#map{height:260px;width:100%;border-radius:12px;margin:12px 0;border:1px solid #374151;z-index:1}' +
      '.status-badge{margin-top:14px;padding:12px 14px;border-radius:10px;font-size:14px;background:#1e293b;border-left:4px solid #38bdf8}' +
      '.alert-success{background:#064e3b;color:#a7f3d0;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-weight:500;font-size:14px;border:1px solid #059669}' +
      '.coords-tag{font-family:monospace;color:#38bdf8;font-weight:bold}' +
      '.search-row{display:flex;gap:8px;margin-bottom:10px}.search-row input{flex:1}' +
      '.ev{padding:10px 14px;background:#1f293d;border-radius:8px;margin-top:8px;display:flex;justify-content:space-between;font-size:14px}' +
      'ol{padding-left:20px;color:#cbd5e1;font-size:13px;line-height:1.6}li{margin-bottom:6px}' +
      '</style></head><body><div class="container">' +
      bannerHtml +
      '<div class="card">' +
      '<h1>🌤️ Weather &amp; Exact Location</h1>' +
      '<p>Pinpoint your exact location for real local weather and true sunrise/sunset on your Samsung Freestyle projector screen.</p>' +
      '<button type="button" class="btn btn-green btn-full" onclick="syncLocation()">📍 Auto-Detect / Sync Phone Location</button>' +
      '<div id="gpsStatus" style="font-size:13px;margin:8px 0 12px;min-height:18px;"></div>' +
      '<div class="search-row">' +
      '<input type="text" id="addrInput" placeholder="Search address, neighborhood, or city...">' +
      '<button type="button" class="btn btn-gray" onclick="searchAddress()">🔍 Find</button>' +
      '</div>' +
      '<div id="map"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:13px;">' +
      '<span>Pin: <span id="dispCoords" class="coords-tag"></span></span>' +
      '<span style="color:#9ca3af">Tap or drag pin to your house</span>' +
      '</div>' +
      '<form action="/save_location" method="POST">' +
      '<input type="hidden" id="latInput" name="lat" value="' + parsedLat + '">' +
      '<input type="hidden" id="lonInput" name="lon" value="' + parsedLon + '">' +
      '<button type="submit" class="btn btn-green btn-full" style="font-size:16px;">💾 Save Pin Location to Projector</button>' +
      '</form>' +
      '<div style="margin-top:16px;border-top:1px solid #1f293d;padding-top:14px;">' +
      '<small style="color:#9ca3af">Or enter City, Postal code, or paste Google Maps coordinates:</small>' +
      '<form action="/save_location" method="POST" style="display:flex;gap:8px;margin-top:6px;">' +
      '<input type="text" name="city" id="pasteInput" oninput="onPasteInput(this.value)" placeholder="e.g. City name, Postal code, or Latitude, Longitude" value="' + (locationQuery || '') + '">' +
      '<button type="submit" class="btn" style="width:auto;padding:0 20px;">Save</button>' +
      '</form>' +
      '</div>' +
      '<div class="status-badge">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<div><b>Current Weather on TV:</b><br><span style="font-size:16px;color:#38bdf8;font-weight:600;">' + weatherSummary + '</span><br>' +
      '<small style="color:#9ca3af;">Location: ' + (locationQuery || 'Auto IP') + '</small></div>' +
      '<a href="/refresh_weather" class="btn btn-gray" style="padding:6px 12px;font-size:12px;text-decoration:none;">🔄 Refresh</a>' +
      '</div></div></div>' +
      '<div class="card">' +
      '<h1>📅 Projector Calendar Setup</h1>' +
      '<p>Connect your <b>Google Calendar</b> or <b>Samsung Calendar</b> to display your schedule on the projector home screen.</p>' +
      '<form action="/save_calendar" method="POST">' +
      '<label style="font-size:13px;color:#cbd5e1;"><b>Google Calendar Secret iCal Link (.ics):</b></label>' +
      '<input type="url" name="url" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" required value="' + (calendarUrl || '') + '">' +
      '<button type="submit" class="btn btn-full" style="margin-top:10px;">Save &amp; Sync Calendar</button>' +
      '</form>' +
      '<div class="status-badge"><b>Status:</b> ' + (calendarUrl ? 'Connected (' + cachedEvents.length + ' upcoming events)' : 'Not configured yet') + '</div>' +
      (evHtml ? '<h3>Upcoming Events on Projector:</h3>' + evHtml : '') +
      '<h3 style="font-size:15px;color:#60a5fa;margin-top:18px;">How to get your Google Calendar link:</h3>' +
      '<ol>' +
      '<li>Open Google Calendar in your web browser.</li>' +
      '<li>On the left, find your calendar, click the <b>3 dots</b> &rarr; <b>Settings and sharing</b>.</li>' +
      '<li>Scroll down to <b>"Integrate calendar"</b>.</li>' +
      '<li>Copy the <b>"Secret address in iCal format"</b>.</li>' +
      '<li>Paste it in the box above and click <b>Save</b>!</li>' +
      '</ol>' +
      '</div></div>' +
      '<script>' +
      'var curLat = ' + parsedLat + ';' +
      'var curLon = ' + parsedLon + ';' +
      'var map = L.map("map").setView([curLat, curLon], 13);' +
      'L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {maxZoom: 19, attribution: "&copy; OpenStreetMap"}).addTo(map);' +
      'var marker = L.marker([curLat, curLon], {draggable: true}).addTo(map);' +
      'function setPin(lat, lon, zoom) {' +
      'lat = parseFloat(lat); lon = parseFloat(lon);' +
      'if (isNaN(lat) || isNaN(lon)) return;' +
      'curLat = lat; curLon = lon;' +
      'marker.setLatLng([lat, lon]);' +
      'if (zoom) map.setView([lat, lon], zoom);' +
      'else map.panTo([lat, lon]);' +
      'document.getElementById("latInput").value = lat.toFixed(6);' +
      'document.getElementById("lonInput").value = lon.toFixed(6);' +
      'document.getElementById("dispCoords").textContent = lat.toFixed(4) + ", " + lon.toFixed(4);' +
      '}' +
      'setPin(curLat, curLon, 13);' +
      'marker.on("dragend", function() { var p = marker.getLatLng(); setPin(p.lat, p.lng); });' +
      'map.on("click", function(e) { setPin(e.latlng.lat, e.latlng.lng); });' +
      'function searchAddress() {' +
      'var q = document.getElementById("addrInput").value.trim();' +
      'if (!q) return;' +
      'var s = document.getElementById("gpsStatus");' +
      's.style.color = "#60a5fa"; s.textContent = "Searching location...";' +
      'fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q))' +
      '.then(function(r) { return r.json(); })' +
      '.then(function(res) { if (res && res.length > 0) { var r = res[0]; s.style.color = "#34d399"; s.textContent = "Found: " + r.display_name.split(",").slice(0, 3).join(","); setPin(r.lat, r.lon, 14); } else { s.style.color = "#f59e0b"; s.textContent = "Location not found. Try another city or postal code."; } })' +
      '.catch(function() { s.style.color = "#ef4444"; s.textContent = "Search failed. You can drag the pin manually."; });' +
      '}' +
      'function onPasteInput(val) {' +
      'var gMap = val.match(/@(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)/) || val.match(/q=(-?\\d+\\.\\d+),(-?\\d+\\.\\d+)/);' +
      'var coords = val.match(/^(-?\\d+\\.\\d+)\\s*,\\s*(-?\\d+\\.\\d+)$/);' +
      'if (gMap) setPin(gMap[1], gMap[2], 14);' +
      'else if (coords) setPin(coords[1], coords[2], 14);' +
      '}' +
      'function syncLocation() {' +
      'var s = document.getElementById("gpsStatus");' +
      's.style.color = "#60a5fa"; s.textContent = "Checking location...";' +
      'function onNetworkFallback(msg) {' +
      's.style.color = "#f59e0b"; s.textContent = msg + " Auto-detecting via network IP...";' +
      'fetch("https://ipwho.is/")' +
      '.then(function(r) { return r.json(); })' +
      '.then(function(d) { if (d && d.success && d.latitude && d.longitude) { s.style.color = "#34d399"; s.textContent = "📍 Found: " + (d.city || "") + ", " + (d.region || "") + " (" + d.latitude.toFixed(4) + ", " + d.longitude.toFixed(4) + "). Tap pin on map to fine-tune!"; setPin(d.latitude, d.longitude, 13); } else { s.style.color = "#ef4444"; s.textContent = "Could not auto-detect. Please tap your location on the map."; } })' +
      '.catch(function() { s.style.color = "#ef4444"; s.textContent = "Network check failed. You can tap your location on the map."; });' +
      '}' +
      'if (!window.isSecureContext && location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {' +
      'onNetworkFallback("Phone browser restricts hardware GPS over HTTP."); return;' +
      '}' +
      'if (navigator.geolocation) {' +
      'navigator.geolocation.getCurrentPosition(' +
      'function(pos) { s.style.color = "#34d399"; s.textContent = "📍 GPS acquired! Pin updated on map."; setPin(pos.coords.latitude, pos.coords.longitude, 15); },' +
      'function(err) { onNetworkFallback("Hardware GPS unavailable (" + err.message + ")."); },' +
      '{ timeout: 5000, enableHighAccuracy: true }' +
      ');' +
      '} else {' +
      'onNetworkFallback("Geolocation not supported.");' +
      '}' +
      '}' +
      '</script></body></html>';
    res.end(html);
    return;
  }
  if (path === 'watch' || path === 'stop' || path === 'guard' || path === 'pause' || path === 'away') {
    handle(path, parsed.query);
    res.end('ok');
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});
server.on('error', function (e) { log('could not listen on port ' + PORT + ': ' + e.message); });

module.exports = {
  onStart: function () {
    var t = new Date();
    startedAt = t.toDateString().slice(0, 10) + ' ' + t.toTimeString().slice(0, 8);
    log('started');
    try { server.listen(PORT, '0.0.0.0', function () { log('listening on 0.0.0.0:' + PORT); }); } catch (e) { log('listen threw: ' + e.message); }
    guard.timer = setInterval(guardTick, 5000);
  },
  onRequest: function () {
    var req = readRequest();
    log('request: ' + (req.cmd || '?') + (req.app ? ' ' + req.app : ''));
    handle(req.cmd, req);
  },
  onExit: function () { stop('helper exiting'); },
  onStop: function () { stop('helper stopping'); }
};
