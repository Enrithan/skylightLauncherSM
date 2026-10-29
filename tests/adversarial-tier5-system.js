/**
 * tests/adversarial-tier5-system.js
 *
 * Tier 5 Adversarial Coverage Hardening: App Controller, Service Daemon & System Integration
 * Challenger 2 White-Box Stress & Edge Case Verification Suite
 *
 * Verification Areas:
 * 1. App Controller & Remote Focus Stress (D-pad hammering, boundary clamping, diary toggle, lost focus, empty grid, hold menu)
 * 2. Visibility & Clock Lifecycle (rapid visibility flips during launch, launch failure recovery, watchdog timeout, tick resume, curtain invariance)
 * 3. Service Helper Daemon (routing, 404s, malformed queries, /stats schema, /procs cache boundary, /kill_proc security, ICS & weather parsers)
 * 4. WGT Packaging & System Distribution (forward-slash normalization across all depths, package size <= 680 KB with >= 20 KB headroom)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const assert = require('assert');

const {
  PROJECT_ROOT,
  SKYLIGHT_DIR,
  INDEX_HTML_PATH,
  SCENERY_JS_PATH,
  APP_JS_PATH,
  createSandbox
} = require('./e2e/test-helpers');

const WGT_PATH = path.join(PROJECT_ROOT, 'dist', 'Skylight.wgt');
const SERVICE_JS_PATH = path.join(SKYLIGHT_DIR, 'service', 'index.js');
const CATALOG_JS_PATH = path.join(SKYLIGHT_DIR, 'js', 'catalog.js');

const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const sceneryJsContent = fs.readFileSync(SCENERY_JS_PATH, 'utf8');
const appJsContent = fs.readFileSync(APP_JS_PATH, 'utf8');
const serviceJsContent = fs.readFileSync(SERVICE_JS_PATH, 'utf8');
const catalogJsContent = fs.readFileSync(CATALOG_JS_PATH, 'utf8');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => {
          passedTests++;
          console.log(`  [PASS] ${name}`);
        })
        .catch(err => {
          failedTests++;
          console.error(`  [FAIL] ${name}: ${err.message}`);
          failures.push({ name, error: err });
        });
    } else {
      passedTests++;
      console.log(`  [PASS] ${name}`);
      return Promise.resolve();
    }
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failures.push({ name, error: err });
    return Promise.resolve();
  }
}

// Helper to create a fully functioning App Controller sandbox
function createAppSandbox(options = {}) {
  const sb = createSandbox(options.html || htmlContent);
  sb.Image = function () {
    return sb.document.createElement('img');
  };

  // Ensure mock Element has boolean hidden property matching real DOM
  const sampleEl = sb.document.createElement('div');
  if (sampleEl.constructor && sampleEl.constructor.prototype) {
    Object.defineProperty(sampleEl.constructor.prototype, 'hidden', {
      get() { return this.hasAttribute('hidden') || this._hidden === true; },
      set(val) {
        this._hidden = !!val;
        if (val) this.setAttribute('hidden', '');
        else this.removeAttribute('hidden');
      },
      configurable: true
    });
  }

  sb.window.tizen = {
    application: {
      getCurrentApplication: () => ({ appInfo: { version: '2.4.0', id: 'skylightTV.Skylight' } }),
      launch: (id, s, e) => {
        if (options.launchFail) {
          if (e) e(new Error('Simulated launch failure: ' + id));
        } else {
          if (s) s();
        }
      },
      launchAppControl: (ctrl, id, s, e) => {
        if (options.launchFail) {
          if (e) e(new Error('Simulated appControl failure: ' + id));
        } else {
          if (s) s();
        }
      },
      getAppsContext: s => s(options.runningApps || []),
      getAppsInfo: s => s(options.installedApps || null),
      kill: (ctxId, s) => { if (s) s(); }
    },
    ApplicationControl: function (op) { this.operation = op; },
    ApplicationControlData: function (k, v) { this.key = k; this.value = v; }
  };
  sb.window.innerWidth = 1920;
  sb.window.innerHeight = 1080;
  sb.window.addEventListener = (ev, fn) => sb.document.addEventListener(ev, fn);

  vm.runInContext(catalogJsContent, sb);
  vm.runInContext(sceneryJsContent, sb);
  vm.runInContext(appJsContent, sb);

  return sb;
}

// Helper to capture Service Daemon HTTP request handler
function createServiceDaemon() {
  let capturedHandler = null;
  const customHttp = Object.assign({}, http, {
    createServer: handler => {
      capturedHandler = handler;
      return {
        on: () => {},
        listen: () => {}
      };
    }
  });

  const context = vm.createContext({
    require: mod => (mod === 'http' ? customHttp : require(mod)),
    process: process,
    console: { log: () => {} },
    Buffer: Buffer,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    module: { exports: {} }
  });

  vm.runInContext(serviceJsContent, context);

  function executeRequest(reqUrl, method = 'GET', postBody = '') {
    return new Promise(resolve => {
      const headers = {};
      let statusCode = 200;
      let body = '';

      const req = {
        url: reqUrl,
        method: method,
        headers: {},
        on: (event, handler) => {
          if (event === 'data' && postBody) handler(postBody);
          if (event === 'end') handler();
        }
      };

      const res = {
        setHeader: (k, v) => { headers[k] = v; },
        writeHead: (code, hdrs) => {
          statusCode = code;
          if (hdrs) Object.assign(headers, hdrs);
        },
        get statusCode() { return statusCode; },
        set statusCode(v) { statusCode = v; },
        end: data => {
          if (data) body += data;
          resolve({ statusCode, headers, body });
        }
      };

      capturedHandler(req, res);
    });
  }

  return { context, executeRequest };
}

async function runAll() {
  console.log('=================================================================');
  console.log('  CHALLENGER 2: TIER 5 ADVERSARIAL COVERAGE HARDENING');
  console.log('  App Controller, Service Daemon, & System Integration');
  console.log('=================================================================\n');

  // ============================================================================
  // Suite 1: App Controller & Remote Focus Stress
  // ============================================================================
  console.log('--- Suite 1: App Controller & Remote Focus Stress ---');

  await test('1.1: Rapid D-pad Hammering (1,000 rapid random keydowns in 0ms keeps focus clamped and valid)', () => {
    const sb = createAppSandbox();
    const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 };
    const keys = [KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN];

    for (let i = 0; i < 1000; i++) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      sb.document.dispatchEvent({ type: 'keydown', keyCode: k, preventDefault: () => {} });
    }

    const focusedTiles = sb.document.querySelectorAll('.tile.is-focused');
    assert.strictEqual(focusedTiles.length, 1, `Exactly one tile must be focused, found ${focusedTiles.length}`);

    const captionTitle = sb.document.getElementById('captionTitle').textContent;
    assert.ok(captionTitle.length > 0, 'Caption title must not be empty');

    const favRow = sb.document.getElementById('favourites');
    const allRow = sb.document.getElementById('all');
    assert.ok(favRow.style.transform.startsWith('translate3d('), 'Favourites row must use translate3d');
    assert.ok(allRow.style.transform.startsWith('translate3d('), 'All apps row must use translate3d');

    sb.dispose();
  });

  await test('1.2: Boundary Focus Clamping & Wraparound Invariance', () => {
    const sb = createAppSandbox();
    const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 };

    // Row 0 UP clamping (50 bursts)
    for (let i = 0; i < 50; i++) {
      sb.document.dispatchEvent({ type: 'keydown', keyCode: KEY.UP, preventDefault: () => {} });
    }
    const focused1 = sb.document.querySelector('.tile.is-focused');
    assert.ok(focused1.parentNode.id === 'favourites', 'Row 0 UP must remain clamped on favourites');

    // Move to Row 1 DOWN clamping (50 bursts)
    for (let i = 0; i < 50; i++) {
      sb.document.dispatchEvent({ type: 'keydown', keyCode: KEY.DOWN, preventDefault: () => {} });
    }
    const focused2 = sb.document.querySelector('.tile.is-focused');
    assert.ok(focused2.parentNode.id === 'all', 'Row 1 DOWN must remain clamped on all row');

    // Move to far left (50 bursts)
    for (let i = 0; i < 50; i++) {
      sb.document.dispatchEvent({ type: 'keydown', keyCode: KEY.LEFT, preventDefault: () => {} });
    }
    const leftTile = sb.document.querySelector('.tile.is-focused');
    assert.strictEqual(leftTile.parentNode.children[0], leftTile, 'Far left must clamp at column 0');

    // Move to far right (100 bursts)
    for (let i = 0; i < 100; i++) {
      sb.document.dispatchEvent({ type: 'keydown', keyCode: KEY.RIGHT, preventDefault: () => {} });
    }
    const rightTile = sb.document.querySelector('.tile.is-focused');
    const allChildren = rightTile.parentNode.children;
    assert.strictEqual(allChildren[allChildren.length - 1], rightTile, 'Far right must clamp at last column');

    sb.dispose();
  });

  await test('1.3: Diagnostics Diary Trigger & Reset Counter', () => {
    const sb = createAppSandbox();
    const diary = sb.document.getElementById('diary');
    assert.strictEqual(diary.hidden, true, 'Diary must be hidden initially');

    // Exactly 3 UP presses on Row 0 toggles diary
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    assert.strictEqual(diary.hidden, false, 'Diary must be visible after 3 consecutive UP presses');

    // 3 more UP presses toggles it back to hidden
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    assert.strictEqual(diary.hidden, true, 'Diary must be hidden after 3 more UP presses');

    // Interrupted sequence: 2 UP, 1 RIGHT, 1 UP does NOT toggle diary
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 39, preventDefault: () => {} }); // interrupted
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} });
    assert.strictEqual(diary.hidden, true, 'Diary must remain hidden when sequence is interrupted');

    sb.dispose();
  });

  await test('1.4: Dynamic Focus Recovery & Self-Healing on App Hide Action', () => {
    let holdCb = null;
    const sb = createAppSandbox();
    const origSetTimeout = sb.setTimeout;
    sb.setTimeout = (fn, ms) => {
      if (ms === 650) holdCb = fn;
      return origSetTimeout(fn, ms);
    };

    const initialTitle = sb.document.getElementById('captionTitle').textContent;
    assert.strictEqual(initialTitle, 'Netflix');

    // 1. Hold Enter to open hold-OK menu
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    assert.ok(holdCb, 'Hold timer must be armed');
    holdCb();
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} }); // release hold

    const menuEl = sb.document.getElementById('menu');
    assert.strictEqual(menuEl.classList.contains('is-open'), true, 'Menu must be open');

    // 2. Arrow down to 'Hide app' (index 1)
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 40, preventDefault: () => {} });

    // 3. Press Enter to choose 'Hide app'
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} });

    assert.strictEqual(menuEl.classList.contains('is-open'), false, 'Menu must close after hide');
    const newTitle = sb.document.getElementById('captionTitle').textContent;
    assert.ok(newTitle.length > 0 && newTitle !== 'Netflix', 'Focus must self-heal to next visible app');
    assert.strictEqual(sb.localStorage.getItem('skylight.hidden'), 'org.tizen.netflix-app');

    sb.dispose();
  });

  await test('1.5: Empty Favourites & Target Boundary Navigation Resilience', () => {
    const sb = createAppSandbox();

    // Configure all favorites to be hidden or moved to all
    sb.localStorage.setItem('order.favourites', '');
    sb.localStorage.setItem('order.all', 'org.tizen.netflix-app,9Ur5IzDKqV.TizenYouTube,org.tizen.primevideo');

    // Trigger resume/rebuild
    sb.document.dispatchEvent({ type: 'skylight:resume' });

    // Focus starts on Row 0 or clamps to Row 1 if Row 0 has 0 items
    // Test that pressing UP on Row 1 when Row 0 has 0 items does not crash
    for (let i = 0; i < 20; i++) {
      sb.document.dispatchEvent({ type: 'keydown', keyCode: 38, preventDefault: () => {} }); // UP
      sb.document.dispatchEvent({ type: 'keydown', keyCode: 39, preventDefault: () => {} }); // RIGHT
      sb.document.dispatchEvent({ type: 'keydown', keyCode: 40, preventDefault: () => {} }); // DOWN
      sb.document.dispatchEvent({ type: 'keydown', keyCode: 37, preventDefault: () => {} }); // LEFT
    }

    const focused = sb.document.querySelectorAll('.tile.is-focused');
    assert.strictEqual(focused.length, 1, 'Focus must remain valid on existing tile');

    sb.dispose();
  });

  await test('1.6: Hold-OK Menu Lifecycle & Rapid Cancellation', () => {
    let timerCb = null;
    const sb = createAppSandbox();
    const origSetTimeout = sb.setTimeout;
    sb.setTimeout = (fn, ms) => {
      if (ms === 650) timerCb = fn;
      return origSetTimeout(fn, ms);
    };

    const menuEl = sb.document.getElementById('menu');
    assert.strictEqual(menuEl.classList.contains('is-open'), false, 'Menu must be closed initially');

    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    assert.ok(timerCb, 'Hold timer must be armed on Enter keydown');
    timerCb(); // trigger hold OK menu

    assert.strictEqual(menuEl.classList.contains('is-open'), true, 'Menu must open after hold timer');
    assert.ok(sb.document.getElementById('menuTitle').textContent.length > 0, 'Menu must show app title');

    // Press BACK key (code 10009 / 27)
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 10009, preventDefault: () => {} });
    assert.strictEqual(menuEl.classList.contains('is-open'), false, 'Menu must close immediately on Back key');

    // Re-verify regular focus navigation works
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 39, preventDefault: () => {} });
    const focused = sb.document.querySelectorAll('.tile.is-focused');
    assert.strictEqual(focused.length, 1, 'Regular tile navigation must resume after menu cancellation');

    sb.dispose();
  });

  // ============================================================================
  // Suite 2: Visibility & Clock Lifecycle Under Adversarial Pressure
  // ============================================================================
  console.log('\n--- Suite 2: Visibility & Clock Lifecycle Under Adversarial Pressure ---');

  await test('2.1: Rapid Async Document.hidden Flips During App Launch Window', () => {
    const sb = createAppSandbox();
    const curtain = sb.document.getElementById('curtain');
    const screen = sb.document.getElementById('screen');

    // Launch currently focused app
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} });

    assert.strictEqual(curtain.classList.contains('is-on'), true, 'Curtain must be on during launch');
    assert.strictEqual(screen.classList.contains('weather-paused'), true, 'Scenery must pause during launch');

    // While 170ms launch timer is pending, rapidly flip document.hidden 50 times
    for (let i = 0; i < 50; i++) {
      sb.document.hidden = true;
      sb.document.dispatchEvent({ type: 'visibilitychange' });
      sb.document.hidden = false;
      sb.document.dispatchEvent({ type: 'visibilitychange' });
    }

    // Settled visible state: uncover must clear curtain and resume scenery
    assert.strictEqual(curtain.classList.contains('is-on'), false, 'Curtain must be cleared once returned visible');
    assert.strictEqual(screen.classList.contains('weather-paused'), false, 'Scenery must resume once returned visible');

    sb.dispose();
  });

  await test('2.2: External App Launch Failure & Error Notification Recovery', () => {
    const sb = createAppSandbox({ launchFail: true });
    const curtain = sb.document.getElementById('curtain');
    const captionNote = sb.document.getElementById('captionNote');

    let launchTimer = null;
    const origSetTimeout = sb.setTimeout;
    sb.setTimeout = (fn, ms) => {
      if (ms === 170) launchTimer = fn;
      return origSetTimeout(fn, ms);
    };

    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} });

    assert.strictEqual(curtain.classList.contains('is-on'), true);
    assert.ok(launchTimer, '170ms launch timer must be scheduled');

    // Fire launch failure
    launchTimer();

    assert.strictEqual(curtain.classList.contains('is-on'), false, 'Curtain must be removed on launch failure');
    assert.strictEqual(captionNote.classList.contains('is-error'), true, 'Caption note must have .is-error on launch failure');
    assert.ok(captionNote.textContent.includes('didn’t open'), 'Caption note must explain failure');

    sb.dispose();
  });

  await test('2.3: Stalled External Launch Watchdog Recovery (6000ms Timeout)', () => {
    let timer170 = null;
    let timer6000 = null;
    const sb = createAppSandbox();
    const origSetTimeout = sb.setTimeout;
    sb.setTimeout = (fn, ms) => {
      if (ms === 170) timer170 = fn;
      if (ms === 6000) timer6000 = fn;
      return origSetTimeout(fn, ms);
    };

    const curtain = sb.document.getElementById('curtain');

    // Trigger launch
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} });

    assert.strictEqual(curtain.classList.contains('is-on'), true);
    assert.ok(timer170, '170ms transition timer must be scheduled');

    // Fire 170ms transition timer -> calls launchInGroup -> schedules 6000ms watchdog
    timer170();

    assert.ok(timer6000, 'Watchdog 6000ms timer must be scheduled');
    sb.document.hidden = false; // TV never hid page
    timer6000(); // watchdog fires

    assert.strictEqual(curtain.classList.contains('is-on'), false, 'Watchdog must uncover curtain if TV never hides page');

    sb.dispose();
  });

  await test('2.4: Clock Tick Resumption & Timestamp Integrity Across Visibility Boundary', () => {
    const sb = createAppSandbox();

    // Verify initial time rendered
    const timeEl = sb.document.getElementById('time');
    const meridiemEl = sb.document.getElementById('meridiem');
    const greetingEl = sb.document.getElementById('greeting');
    const dateEl = sb.document.getElementById('date');

    assert.ok(timeEl.textContent.includes(':'), 'Time must contain colon');
    assert.ok(meridiemEl.textContent === 'am' || meridiemEl.textContent === 'pm');

    // Hide document (stops tick)
    sb.document.hidden = true;
    sb.document.dispatchEvent({ type: 'visibilitychange' });

    // Mock Date jump to 2:45 PM
    const fixedDate = new Date(2026, 9, 29, 14, 45, 0); // Oct 29 2026 14:45
    sb.Date = class extends Date {
      constructor(...args) {
        if (args.length) super(...args);
        else return fixedDate;
      }
      static now() { return fixedDate.getTime(); }
    };

    // Show document (resumes tick)
    sb.document.hidden = false;
    sb.document.dispatchEvent({ type: 'visibilitychange' });

    assert.strictEqual(timeEl.textContent, '2:45', 'Time must update to 2:45');
    assert.strictEqual(meridiemEl.textContent, 'pm', 'Meridiem must update to pm');
    assert.strictEqual(greetingEl.textContent, 'Good afternoon', 'Greeting must update to Good afternoon');
    assert.ok(dateEl.textContent.includes('October'), 'Date must include October');

    sb.dispose();
  });

  await test('2.5: Curtain State & Color Invariance Under Rapid Activation Bursts', () => {
    const sb = createAppSandbox();
    const curtain = sb.document.getElementById('curtain');

    // Launch app
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} });

    const tileColor = curtain.style.getPropertyValue('--c');
    assert.ok(tileColor && tileColor.length > 0, 'Curtain must set --c to app tile color');

    // Attempt second launch while launching === true
    sb.document.dispatchEvent({ type: 'keydown', keyCode: 13, preventDefault: () => {} });
    sb.document.dispatchEvent({ type: 'keyup', keyCode: 13, preventDefault: () => {} });

    // Curtain color must remain identical (second launch rejected)
    assert.strictEqual(curtain.style.getPropertyValue('--c'), tileColor, 'Curtain color must not mutate while launching');

    sb.dispose();
  });

  // ============================================================================
  // Suite 3: Service Helper Daemon Edge Cases
  // ============================================================================
  console.log('\n--- Suite 3: Service Helper Daemon Edge Cases ---');

  const daemon = createServiceDaemon();

  await test('3.1: Helper Daemon HTTP Routing & 404 Resilience', async () => {
    const resStats = await daemon.executeRequest('/stats');
    assert.strictEqual(resStats.statusCode, 200, '/stats must return 200');
    assert.strictEqual(resStats.headers['Access-Control-Allow-Origin'], '*', 'CORS must be enabled');
    assert.strictEqual(resStats.headers['Cache-Control'], 'no-store', 'Cache-Control must be no-store');

    const resProcs = await daemon.executeRequest('/procs');
    assert.strictEqual(resProcs.statusCode, 200, '/procs must return 200');

    const resLog = await daemon.executeRequest('/log');
    assert.strictEqual(resLog.statusCode, 200, '/log must return 200');

    const resNotFound = await daemon.executeRequest('/non_existent_route');
    assert.strictEqual(resNotFound.statusCode, 404, 'Unknown routes must return 404');
    assert.strictEqual(resNotFound.body, 'not found');
  });

  await test('3.2: Malformed URI & Query Parameter Robustness', async () => {
    // Malformed percent encodings
    const resBadUri = await daemon.executeRequest('/stats?bad=%ZZ%FF');
    assert.strictEqual(resBadUri.statusCode, 200, 'Malformed query must not crash daemon');

    const resBadLoc = await daemon.executeRequest('/save_location?lat=%ZZ&lon=%ZZ');
    assert.strictEqual(resBadLoc.statusCode, 200, 'Malformed coordinates must not crash daemon');

    const resBadCal = await daemon.executeRequest('/save_calendar?url=%%%');
    assert.strictEqual(resBadCal.statusCode, 200, 'Malformed calendar URL must not crash daemon');
  });

  await test('3.3: Telemetry /stats Schema & Cross-Platform Integrity', async () => {
    const res = await daemon.executeRequest('/stats');
    const stats = JSON.parse(res.body);

    assert.strictEqual(typeof stats.cpuPercent, 'number', 'cpuPercent must be number');
    assert.ok(stats.cpuPercent >= 0 && stats.cpuPercent <= 100, `cpuPercent ${stats.cpuPercent} out of [0, 100]`);

    assert.strictEqual(typeof stats.cpuCores, 'number', 'cpuCores must be number');
    assert.ok(stats.cpuCores >= 1, 'cpuCores must be >= 1');

    assert.strictEqual(typeof stats.ramUsedMB, 'number', 'ramUsedMB must be number');
    assert.strictEqual(typeof stats.ramTotalMB, 'number', 'ramTotalMB must be number');
    assert.strictEqual(typeof stats.ramFreeMB, 'number', 'ramFreeMB must be number');
    assert.ok(stats.ramTotalMB > 0, 'ramTotalMB must be > 0');
    assert.ok(stats.ramPercent >= 0 && stats.ramPercent <= 100, 'ramPercent must be in [0, 100]');

    assert.strictEqual(typeof stats.uptimeMin, 'number', 'uptimeMin must be number');
    assert.strictEqual(typeof stats.helperRamMB, 'number', 'helperRamMB must be number');
    assert.ok(stats.helperRamMB > 0, 'helperRamMB must be > 0');
  });

  await test('3.4: Process Telemetry /procs Caching Expiration Boundary', async () => {
    const res1 = await daemon.executeRequest('/procs');
    assert.strictEqual(res1.statusCode, 200);
    const data1 = JSON.parse(res1.body);
    assert.ok(data1.ok, '/procs must return ok: true');

    // Subsequent request within 2500ms returns cached response
    const res2 = await daemon.executeRequest('/procs');
    const data2 = JSON.parse(res2.body);
    assert.deepStrictEqual(data1, data2, 'Subsequent call within 2500ms must return cached result');
  });

  await test('3.5: Process Kill Safety Guardrails (/kill_proc)', async () => {
    // Attempt killing protected / invalid PIDs
    const protectedPids = ['0', '1', '-1', 'abc', '', 'NaN'];
    for (const p of protectedPids) {
      const res = await daemon.executeRequest(`/kill_proc?pid=${p}`);
      assert.strictEqual(res.statusCode, 200);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.ok, false, `PID ${p} must be rejected`);
      assert.strictEqual(json.error, 'invalid pid');
    }

    // High non-existent PID
    const resHigh = await daemon.executeRequest('/kill_proc?pid=99999999');
    assert.strictEqual(resHigh.statusCode, 200);
    const jsonHigh = JSON.parse(resHigh.body);
    assert.strictEqual(jsonHigh.ok, false, 'Non-existent PID kill must return error without crash');
  });

  await test('3.6: Calendar ICS Parser Stress & Edge Case Tolerance', () => {
    const parseIcs = vm.runInContext('parseIcs', daemon.context);
    assert.strictEqual(typeof parseIcs, 'function');

    // Empty string
    const emptyResult = parseIcs('');
    assert.strictEqual(emptyResult.length, 0, 'Empty string must return 0 events');

    // Malformed ICS without VEVENT
    const noEventResult = parseIcs('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
    assert.strictEqual(noEventResult.length, 0, 'No event must return 0 events');

    // Valid VEVENT with weekly RRULE
    const icsWeekly = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Weekly Standup',
      'DTSTART:20261001T090000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const events = parseIcs(icsWeekly);
    assert.ok(events.length > 0, 'Recurring standup must be parsed into upcoming occurrences');
    assert.strictEqual(events[0].title, 'Weekly Standup');

    // 500 lines of gibberish
    const gibberish = 'FOO:BAR\r\n'.repeat(500);
    const gibberishResult = parseIcs(gibberish);
    assert.strictEqual(gibberishResult.length, 0, 'Gibberish must parse safely into 0 events');
  });

  await test('3.7: Atmospheric Weather Mode Integration & Coordinate Extraction', async () => {
    const sb = createAppSandbox();

    // Verify all 6 atmospheric weather modes integrate across Scenery and App Controller micro-icons
    const testCases = [
      { desc: 'Severe Thunderstorm', iconClass: 'weather-icon--flash', screenClass: 'weather-thunder' },
      { desc: 'Drifting Snow Blizzard', iconClass: 'weather-icon--snow', screenClass: 'weather-snow' },
      { desc: 'Continuous Rain and Drizzle', iconClass: 'weather-icon--drop', screenClass: 'weather-rain' },
      { desc: 'Dense Morning Mist & Fog', iconClass: 'weather-icon--cloud', screenClass: 'weather-mist' },
      { desc: 'Overcast Cloud Cover', iconClass: 'weather-icon--cloud', screenClass: 'weather-cloudy' },
      { desc: 'Clear Sunny Day', iconClass: 'weather-icon--sun', screenClass: 'weather-clear' }
    ];

    for (const tc of testCases) {
      sb.Scenery.setWeather({ desc: tc.desc, tempC: 21 });
      const microSvg = sb.document.getElementById('weatherMicroIcon').innerHTML;
      const screen = sb.document.getElementById('screen');
      assert.ok(microSvg.includes(tc.iconClass), `${tc.desc} micro-icon must contain ${tc.iconClass}`);
      assert.ok(screen.classList.contains(tc.screenClass), `${tc.desc} screen must contain ${tc.screenClass}`);
    }

    // Verify coordinate extraction in daemon
    const res1 = await daemon.executeRequest('/save_location?lat=45.4215&lon=-75.6972');
    assert.strictEqual(JSON.parse(res1.body).location, '45.4215,-75.6972');

    await daemon.executeRequest('/save_location', 'POST', 'city=' + encodeURIComponent('https://maps.google.com/?q=51.5074,-0.1278'));
    const res2 = await daemon.executeRequest('/weather');
    assert.strictEqual(JSON.parse(res2.body).location, '51.5074,-0.1278');

    sb.dispose();
  });

  // ============================================================================
  // Suite 4: WGT Packaging & Archive Structure Audit
  // ============================================================================
  console.log('\n--- Suite 4: WGT Packaging & Distribution Audit ---');

  await test('4.1: WGT Archive Forward-Slash Normalization Across All Depths', () => {
    assert.ok(fs.existsSync(WGT_PATH), 'dist/Skylight.wgt must exist');
    const buf = fs.readFileSync(WGT_PATH);
    let offset = 0;
    const entries = [];

    // Parse ZIP Central Directory
    while (offset < buf.length - 4) {
      if (buf.readUInt32LE(offset) === 0x02014b50) {
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
        entries.push(name);
        offset += 46 + nameLen + extraLen + commentLen;
      } else {
        offset++;
      }
    }

    assert.ok(entries.length >= 30, `Expected >= 30 zip entries, got ${entries.length}`);

    for (const entry of entries) {
      assert.strictEqual(
        entry.includes('\\'),
        false,
        `Zip entry "${entry}" contains invalid Windows backslash`
      );
      assert.strictEqual(
        entry.startsWith('/'),
        false,
        `Zip entry "${entry}" must not contain leading slash`
      );
    }

    // Verify critical nested paths
    assert.ok(entries.includes('css/app.css'), 'Must contain css/app.css');
    assert.ok(entries.includes('js/app.js'), 'Must contain js/app.js');
    assert.ok(entries.includes('service/index.js'), 'Must contain service/index.js');
    assert.ok(entries.includes('fonts/atkinson.woff2'), 'Must contain fonts/atkinson.woff2');
  });

  await test('4.2: WGT Package Size Budget & Headroom Verification', () => {
    const stat = fs.statSync(WGT_PATH);
    const maxBytes = 680 * 1024; // 696,320 bytes
    const minHeadroomBytes = 20 * 1024; // 20,480 bytes

    const headroom = maxBytes - stat.size;
    console.log(`         WGT Size: ${(stat.size / 1024).toFixed(2)} KB (${stat.size} bytes)`);
    console.log(`         Headroom: ${(headroom / 1024).toFixed(2)} KB (${headroom} bytes)`);

    assert.ok(
      stat.size <= maxBytes,
      `WGT size ${stat.size} bytes exceeds 680 KB limit (${maxBytes} bytes)`
    );
    assert.ok(
      headroom >= minHeadroomBytes,
      `Headroom ${headroom} bytes is less than 20 KB required (${minHeadroomBytes} bytes)`
    );
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n=================================================================');
  console.log(`  TIER 5 ADVERSARIAL EXECUTION COMPLETE:`);
  console.log(`  Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('=================================================================\n');

  if (failedTests > 0) {
    console.error(`Status: FAILED (${failedTests} tests failed)`);
    process.exit(1);
  } else {
    console.log('Status: ALL ADVERSARIAL TESTS PASSED EMPIRICALLY!');
    process.exit(0);
  }
}

runAll().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
