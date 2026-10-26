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
var url = require('url');

var SKYLIGHT = 'skylightTV.Skylight';
var PORT = 8130;
var MAX_WATCH_MS = 3 * 60 * 60 * 1000;
var job = null; // { appId, shown, baseline, mode, seen, hiddenSince, busy, stops, started, timer }
var lines = [];
var startedAt = '';

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

// ---- Watching --------------------------------------------------------------------------------

function stop(reason) {
  if (job) { clearInterval(job.timer); if (reason) log('stopped watching ' + job.appId + ': ' + reason); }
  job = null;
}

function start(appId, shown) {
  stop('replaced');
  runningApps(function (ids) {
    if (!ids) { log('cannot watch ' + appId + ': the TV would not list running apps'); return; }
    var baseline = {};
    ids.forEach(function (id) { baseline[id] = true; });
    job = { appId: appId, shown: shown, baseline: baseline, mode: '', seen: false, hiddenSince: 0, busy: false,
      stops: 0, started: Date.now(), timer: null };
    appState(appId, function (state) {
      if (!job || job.appId !== appId) return;
      job.mode = state ? 'status' : 'list';
      log('watching ' + appId + (state
        ? ' through the TV’s app status (running ' + state.running + ', on screen ' + state.visible + ')'
        : ' in the running apps, as the status service would not answer'));
      job.timer = setInterval(check, 1000);
    });
  });
}

function check() {
  if (!job) return;
  var age = Date.now() - job.started;
  if (age > MAX_WATCH_MS) { stop('gave up after three hours'); return; }

  if (job.mode === 'status') {
    if (job.busy) return;
    appState(job.appId, function (state) {
      if (!job || !state) return;
      if (state.running && state.visible) {
        if (!job.seen) { job.seen = true; log(job.appId + ' is on screen'); }
        job.hiddenSince = 0;
        job.stops = 0;
        return;
      }
      if (!job.seen) {
        if (age > 30000) stop(job.appId + ' never came on screen');
        return;
      }
      if (!state.running) {
        // Two "not running" answers in a row, so a hiccup in the service doesn't count as an exit.
        if (++job.stops < 2) return;
        log(job.appId + ' has closed');
        runningApps(function (ids) { if (job) settle(ids || []); });
        return;
      }
      // Still running but off screen: exiting YouTube leaves it like this, and so does pressing
      // Home. Give the screen a moment to settle, then see what is showing now.
      if (!job.hiddenSince) { job.hiddenSince = Date.now(); log(job.appId + ' went to the background'); return; }
      if (Date.now() - job.hiddenSince < 1500) return;
      job.busy = true;
      visibleAmong(job.shown, job.appId, function (visible) {
        if (!job) return;
        job.busy = false;
        if (visible.length) {
          log(job.appId + ' was replaced by ' + visible.join(' ') + '; following that instead');
          start(visible[0], job.shown);
          return;
        }
        var shown = job.shown;
        var left = job.appId;
        stop();
        log('bringing Skylight back; ' + left + ' left the screen');
        launchSkylight();
      });
    });
    return;
  }

  runningApps(function (ids) {
    if (!job || !ids) return;
    if (ids.indexOf(job.appId) >= 0) { job.seen = true; return; }
    if (!job.seen) {
      if (age > 10000) stop(job.appId + ' never showed up as running');
      return;
    }
    settle(ids);
  });
}

// Which of these apps (other than `except`) the TV says are on screen right now.
function visibleAmong(ids, except, done) {
  var pending = 0;
  var visible = [];
  ids.forEach(function (id) {
    if (!id || id === except || id === SKYLIGHT) return;
    pending++;
    appState(id, function (state) {
      if (state && state.running && state.visible) visible.push(id);
      if (--pending === 0) done(visible);
    });
  });
  if (!pending) done(visible);
}

// The app has closed: bring Skylight back, unless another app Skylight shows was opened since.
function settle(ids) {
  var j = job;
  stop();
  var openedSince = ids.filter(function (id) {
    return id !== j.appId && id !== SKYLIGHT && !j.baseline[id] && j.shown.indexOf(id) >= 0;
  });
  if (openedSince.length) { log(j.appId + ' closed, but ' + openedSince.join(' ') + ' was opened since'); return; }
  log('bringing Skylight back after ' + j.appId + ' closed');
  launchSkylight();
}

function launchSkylight(onLaunched) {
  try {
    tizen.application.launch(SKYLIGHT, function () { log('Skylight launched'); if (onLaunched) onLaunched(); },
      function (e) { log('launch failed: ' + e.name + ' ' + e.message); });
  } catch (e) {
    log('launch threw: ' + e.name);
  }
}

// ---- Standing guard: Samsung's home never stays on screen -----------------------------------
// Whenever Skylight is off screen and no app opened from it is showing, the helper looks at what
// is. If it is Samsung's home (after the Home button, or when the TV starts up), Skylight is
// opened in its place. A pause (the Samsung tile in Skylight) lets Samsung's screen stay a while.

// Samsung's own screens: the home screen (under whichever name this TV uses) and TV Plus, which
// the TV likes to open at power-on.
var HOME_CANDIDATES = ['com.samsung.tv.coba.newhome', 'com.samsung.tv.home', 'com.samsung.tv.homescreen',
  'org.tizen.homescreen', 'com.samsung.tv.smarthub', 'com.samsung.tv.home.sidebar', 'com.samsung.tv.csfs',
  'HEPsqFNie0.tvplusstandalone'];
var KNOWN_SYSTEM = ['org.tizen.tv-viewer', 'org.tizen.menu'];
// What the TV boots into on its own (the tuner, or TV Plus). In the first minutes after the helper
// starts, if Skylight hasn't been seen yet, these get replaced by Skylight once.
var BOOT_SOURCES = ['org.tizen.tv-viewer', 'HEPsqFNie0.tvplusstandalone'];
var BOOT_WINDOW_MS = 4 * 60 * 1000;
var guard = { shown: [], pausedUntil: 0, busy: false, lastSeen: '', wasAway: false, lastSweep: 0, force: false,
  timer: null, skylightSeen: false, bootDone: false, lastBootTry: 0, since: Date.now(), lastTick: 0 };

function guardTick() {
  // A long gap between ticks means the TV was in standby: treat the wake-up like a fresh start,
  // so a tuner or TV Plus screen gets replaced by Skylight again.
  var now = Date.now();
  if (guard.lastTick && now - guard.lastTick > 20000) {
    guard.since = now;
    guard.skylightSeen = false;
    guard.bootDone = false;
    log('the TV woke up after ' + Math.round((now - guard.lastTick) / 60000) + ' min');
  }
  guard.lastTick = now;
  if (guard.busy) return;
  appState(SKYLIGHT, function (sky) {
    var away = !!sky && !sky.visible;
    if (sky && sky.visible) guard.skylightSeen = true;
    if (away !== guard.wasAway) { guard.wasAway = away; log(away ? 'Skylight left the screen' : 'Skylight is on screen'); }
    if (!away && !guard.force) { guard.lastSeen = ''; return; }
    if (job && !job.hiddenSince && !guard.force) return; // an app opened from Skylight has the screen
    var now = Date.now();
    var force = guard.force;
    guard.force = false;
    guard.busy = true;
    var ids = unique(guard.shown.concat(HOME_CANDIDATES, KNOWN_SYSTEM));
    visibleAmong(ids, '', function (visible) {
      var home = visible.filter(function (id) { return HOME_CANDIDATES.indexOf(id) >= 0; });
      var user = visible.filter(function (id) { return HOME_CANDIDATES.indexOf(id) < 0; });
      if (user.length || !visible.length) {
        if (user.length && user.join(' ') !== guard.lastSeen) { guard.lastSeen = user.join(' '); log('on screen: ' + guard.lastSeen); }
        if (user.length && bootedInto(user, now)) {
          guard.busy = false;
          guard.lastBootTry = now;
          log('the TV started into ' + user.join(' ') + '; opening Skylight instead');
          launchSkylight(function () { guard.bootDone = true; });
          return;
        }
        // Nothing of ours and no known home name: learn what is showing (at most every 6 s).
        if (!visible.length && (force || now - guard.lastSweep > 6000)) { guard.lastSweep = now; sweep(force); } else { guard.busy = false; }
        return;
      }
      guard.busy = false;
      if (home.join(' ') !== guard.lastSeen) { guard.lastSeen = home.join(' '); log('Samsung’s screen is up (' + guard.lastSeen + ')'); }
      if (now < guard.pausedUntil) return;
      log('opening Skylight over it');
      launchSkylight();
    });
  });
}

// True while the TV has just started up on its own source and Skylight hasn't appeared yet.
function bootedInto(visible, now) {
  if (guard.bootDone || guard.skylightSeen || now < guard.pausedUntil) return false;
  if (now - guard.since > BOOT_WINDOW_MS || now - guard.lastBootTry < 5000) return false;
  return visible.every(function (id) { return BOOT_SOURCES.indexOf(id) >= 0; });
}

// Asks the TV about every running app, to learn which one is on screen.
function sweep(force) {
  runningApps(function (ids) {
    if (!ids) { guard.busy = false; return; }
    visibleAmong(unique(ids), '', function (visible) {
      guard.busy = false;
      var key = visible.join(' ');
      if (force || key !== guard.lastSeen) { guard.lastSeen = key; log('on screen (full sweep): ' + (key || 'nothing reported visible')); }
    });
  });
}

function unique(list) {
  var seen = {};
  return list.filter(function (id) { if (!id || seen[id]) return false; seen[id] = true; return true; });
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
    try { server.listen(PORT, '127.0.0.1', function () { log('listening on 127.0.0.1:' + PORT); }); } catch (e) { log('listen threw: ' + e.message); }
    guard.timer = setInterval(guardTick, 1000);
  },
  onRequest: function () {
    var req = readRequest();
    log('request: ' + (req.cmd || '?') + (req.app ? ' ' + req.app : ''));
    handle(req.cmd, req);
  },
  onExit: function () { stop('helper exiting'); },
  onStop: function () { stop('helper stopping'); }
};
