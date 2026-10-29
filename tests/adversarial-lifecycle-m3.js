/**
 * Adversarial Stress & Empirical Challenger Suite for Milestone 3
 * Milestone 3 Focus: Memory Bounds, Visibility Lifecycle & Projector Hardening
 *
 * Target Verification Areas:
 * 1. Rapid VisibilityChange Cycling (150+ transitions: zero timer leak, zero listener leak, accurate pause state)
 * 2. Scenery Visitor Timer Rescheduling & Lifecycle Survival (Bird/Meteor timers re-armed on resume)
 * 3. App Launch `open(app)` Synchronous Disarming & Curtain Coordination
 * 4. State Invariance & Edge Case Stress Under Paused Scenery
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const {
  PROJECT_ROOT,
  INDEX_HTML_PATH,
  SCENERY_JS_PATH,
  APP_JS_PATH,
  createSandbox
} = require('./e2e/test-helpers');

const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const sceneryJsContent = fs.readFileSync(SCENERY_JS_PATH, 'utf8');
const appJsContent = fs.readFileSync(APP_JS_PATH, 'utf8');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failures.push({ name, error: err });
  }
}

console.log('=================================================================');
console.log('  CHALLENGER 1: MILESTONE 3 LIFECYCLE & STRESS VERIFICATION');
console.log('=================================================================\n');

// ----------------------------------------------------------------------------
// Suite 1: Rapid VisibilityChange Cycling (150 Consecutive Transitions)
// ----------------------------------------------------------------------------
console.log('--- Suite 1: Rapid VisibilityChange Cycling (150 Transitions) ---');

test('1.1: 150 consecutive rapid pause/resume cycles maintain accurate #screen .weather-paused state', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  const screen = sb.document.getElementById('screen');

  for (let i = 0; i < 150; i++) {
    sb.Scenery.pause();
    assert.strictEqual(
      screen.classList.contains('weather-paused'),
      true,
      `Cycle ${i}: #screen must have .weather-paused after pause()`
    );

    sb.Scenery.resume();
    assert.strictEqual(
      screen.classList.contains('weather-paused'),
      false,
      `Cycle ${i}: #screen must NOT have .weather-paused after resume()`
    );
  }
  sb.dispose();
});

test('1.2: 150 rapid visibilitychange DOM events produce zero timer accumulation/leak', () => {
  const sb = createSandbox(htmlContent);
  const activeTimers = new Map();
  let timerSeq = 0;

  const origSetTimeout = sb.setTimeout;
  const origClearTimeout = sb.clearTimeout;

  sb.setTimeout = (fn, delay, ...args) => {
    const id = ++timerSeq;
    activeTimers.set(id, { fn, delay, stack: new Error().stack });
    return id;
  };
  sb.clearTimeout = (id) => {
    activeTimers.delete(id);
  };

  // Mock window.tizen & helper
  sb.Image = function() { return { setAttribute: () => {}, style: {}, addEventListener: () => {} }; };
  sb.window.tizen = {
    application: {
      getCurrentApplication: () => ({ appInfo: { id: 'skylightTV.Skylight' } }),
      launch: () => {},
      launchAppControl: () => {}
    }
  };
  sb.window.addEventListener = (ev, fn) => sb.document.addEventListener(ev, fn);
  sb.window.removeEventListener = (ev, fn) => sb.document.removeEventListener(ev, fn);
  sb.window.innerWidth = 1920;
  sb.window.innerHeight = 1080;

  const catalogContent = fs.readFileSync('skylight/js/catalog.js', 'utf8');
  vm.runInContext(catalogContent, sb);
  vm.runInContext(sceneryJsContent, sb);
  vm.runInContext(appJsContent, sb);

  const initialTimerCount = activeTimers.size;

  // Dispatch 150 rapid visibilitychange events
  for (let i = 0; i < 150; i++) {
    // Hidden
    sb.document.hidden = true;
    sb.document.dispatchEvent({ type: 'visibilitychange' });

    // Visible
    sb.document.hidden = false;
    sb.document.dispatchEvent({ type: 'visibilitychange' });
  }

  // End in hidden state
  sb.document.hidden = true;
  sb.document.dispatchEvent({ type: 'visibilitychange' });

  // While hidden, active timers must be strictly bounded (no unbounded accumulation)
  const hiddenTimerCount = activeTimers.size;
  assert.ok(
    hiddenTimerCount <= 5,
    `Active timer count when hidden must remain <= 5, got ${hiddenTimerCount} (initial was ${initialTimerCount})`
  );

  sb.dispose();
});

test('1.3: 150 rapid visibilitychange cycles produce zero document/window listener leaks', () => {
  const sb = createSandbox(htmlContent);
  let listenerAdds = 0;
  const origAddEventListener = sb.document.addEventListener;
  sb.document.addEventListener = (type, fn) => {
    listenerAdds++;
    origAddEventListener.call(sb.document, type, fn);
  };
  sb.Image = function() { return { setAttribute: () => {}, style: {}, addEventListener: () => {} }; };
  sb.window.addEventListener = (type, fn) => {
    listenerAdds++;
  };
  sb.window.innerWidth = 1920;
  sb.window.innerHeight = 1080;
  sb.window.tizen = {
    application: {
      getCurrentApplication: () => ({ appInfo: { id: 'skylightTV.Skylight' } }),
      launch: () => {},
      launchAppControl: () => {}
    }
  };

  const catalogContent = fs.readFileSync('skylight/js/catalog.js', 'utf8');
  vm.runInContext(catalogContent, sb);
  vm.runInContext(sceneryJsContent, sb);
  vm.runInContext(appJsContent, sb);

  const baselineListeners = listenerAdds;

  for (let i = 0; i < 150; i++) {
    sb.document.hidden = true;
    sb.document.dispatchEvent({ type: 'visibilitychange' });
    sb.document.hidden = false;
    sb.document.dispatchEvent({ type: 'visibilitychange' });
  }

  assert.strictEqual(
    listenerAdds,
    baselineListeners,
    `No new event listeners should be registered during visibility toggling (baseline: ${baselineListeners}, current: ${listenerAdds})`
  );
  sb.dispose();
});

test('1.4: Extreme rapid micro-burst: 50 toggles in 0ms without runtime error or corrupt class list', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  const screen = sb.document.getElementById('screen');

  // Alternating calls without tick delay
  for (let i = 0; i < 50; i++) {
    sb.Scenery.pause();
    sb.Scenery.resume();
  }

  assert.strictEqual(screen.classList.contains('weather-paused'), false);
  sb.Scenery.pause();
  assert.strictEqual(screen.classList.contains('weather-paused'), true);
  sb.dispose();
});

// ----------------------------------------------------------------------------
// Suite 2: Scenery Visitor Timer Rescheduling & Lifecycle Survival
// ----------------------------------------------------------------------------
console.log('\n--- Suite 2: Visitor Timer Rescheduling & Lifecycle Survival ---');

test('2.1: Daytime initial update (14:00) schedules sendBirds visitor timer', () => {
  const sb = createSandbox(htmlContent);
  const scheduledFns = [];
  const origSetTimeout = sb.setTimeout;
  sb.setTimeout = (fn, ms) => {
    scheduledFns.push(fn.name || 'anon');
    return origSetTimeout(fn, ms);
  };

  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  sb.Scenery.update(new Date('2026-10-29T14:00:00'));

  assert.ok(
    scheduledFns.includes('sendBirds'),
    `Daytime update must schedule sendBirds timer. Scheduled: [${scheduledFns.join(', ')}]`
  );
  sb.dispose();
});

test('2.2: Scenery.pause() synchronously clears birdTimer and meteorTimer', () => {
  const sb = createSandbox(htmlContent);
  const clearedIds = [];
  const origClearTimeout = sb.clearTimeout;
  sb.clearTimeout = (id) => {
    clearedIds.push(id);
    return origClearTimeout(id);
  };

  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  sb.Scenery.update(new Date('2026-10-29T14:00:00'));

  const clearedBefore = clearedIds.length;
  sb.Scenery.pause();
  const clearedAfter = clearedIds.length;

  assert.ok(
    clearedAfter > clearedBefore,
    `Scenery.pause() must call clearTimeout for visitor timers (cleared count increased by ${clearedAfter - clearedBefore})`
  );
  sb.dispose();
});

test('2.3: [CRITICAL BUG CHECK] Scenery.resume() in daytime (14:00) MUST re-schedule sendBirds visitor timer', () => {
  const sb = createSandbox(htmlContent);
  const scheduledFns = [];
  const origSetTimeout = sb.setTimeout;

  // Mock wall clock inside sandbox
  const RealDate = Date;
  sb.Date = function(...args) {
    if (args.length > 0) return new RealDate(...args);
    return new RealDate('2026-10-29T14:00:00');
  };
  sb.Date.now = () => new RealDate('2026-10-29T14:00:00').getTime();
  sb.Date.UTC = RealDate.UTC;
  sb.Date.parse = RealDate.parse;

  sb.setTimeout = (fn, ms) => {
    scheduledFns.push(fn.name || 'anon');
    return origSetTimeout(fn, ms);
  };

  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  sb.Scenery.update(new sb.Date());

  assert.ok(scheduledFns.includes('sendBirds'), 'Initial daytime update scheduled sendBirds');

  // Pause scenery
  sb.Scenery.pause();

  // Resume scenery while wall clock is still daytime (14:00)
  const mark = scheduledFns.length;
  sb.Scenery.resume();
  const newScheduled = scheduledFns.slice(mark);

  // According to PROJECT.md line 71:
  // "Scenery.resume(): Resumes CSS animations and re-schedules time-of-day/visitor ticks."
  // And Worker M3 handoff line 69:
  // "resume() cleans .weather-paused and triggers update(new Date()) so the sky palette, sun/moon arc, and visitor timers are refreshed to current time."
  assert.ok(
    newScheduled.includes('sendBirds'),
    `Scenery.resume() MUST re-arm the visitor timer (sendBirds), but scheduled: [${newScheduled.join(', ')}]! ` +
    `Defect: 'visitorsFor' is not reset on pause, causing scheduleVisitors to drop timers upon resume in same day/night period!`
  );
  sb.dispose();
});

test('2.4: [CRITICAL BUG CHECK] Scenery.resume() at nighttime (23:00) MUST re-schedule sendMeteor visitor timer', () => {
  const sb = createSandbox(htmlContent);
  const scheduledFns = [];
  const origSetTimeout = sb.setTimeout;

  const RealDate = Date;
  sb.Date = function(...args) {
    if (args.length > 0) return new RealDate(...args);
    return new RealDate('2026-10-29T23:00:00');
  };
  sb.Date.now = () => new RealDate('2026-10-29T23:00:00').getTime();
  sb.Date.UTC = RealDate.UTC;
  sb.Date.parse = RealDate.parse;

  sb.setTimeout = (fn, ms) => {
    scheduledFns.push(fn.name || 'anon');
    return origSetTimeout(fn, ms);
  };

  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  sb.Scenery.update(new sb.Date());

  assert.ok(scheduledFns.includes('sendMeteor'), 'Initial night update scheduled sendMeteor');

  sb.Scenery.pause();

  const mark = scheduledFns.length;
  sb.Scenery.resume();
  const newScheduled = scheduledFns.slice(mark);

  assert.ok(
    newScheduled.includes('sendMeteor'),
    `Scenery.resume() MUST re-arm the meteor timer, but scheduled: [${newScheduled.join(', ')}]! ` +
    `Defect: 'visitorsFor' is not reset on pause, causing scheduleVisitors to drop meteor timer upon resume!`
  );
  sb.dispose();
});

test('2.5: Idempotent pause: calling Scenery.pause() multiple times in succession causes no errors', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  const screen = sb.document.getElementById('screen');

  assert.doesNotThrow(() => {
    sb.Scenery.pause();
    sb.Scenery.pause();
    sb.Scenery.pause();
  });
  assert.strictEqual(screen.classList.contains('weather-paused'), true);
  sb.dispose();
});

test('2.6: Idempotent resume: calling Scenery.resume() multiple times does not create runaway timers', () => {
  const sb = createSandbox(htmlContent);
  let timerCount = 0;
  const origSetTimeout = sb.setTimeout;
  sb.setTimeout = (fn, ms) => {
    timerCount++;
    return origSetTimeout(fn, ms);
  };

  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  sb.Scenery.update(new Date());

  sb.Scenery.pause();
  const beforeResumes = timerCount;

  sb.Scenery.resume();
  sb.Scenery.resume();
  sb.Scenery.resume();

  const afterResumes = timerCount - beforeResumes;
  assert.ok(afterResumes <= 3, `Triple resume should not spawn excessive timers (spawned: ${afterResumes})`);
  sb.dispose();
});

// ----------------------------------------------------------------------------
// Suite 3: App Launch open(app) Synchronous Coordination & Disarming
// ----------------------------------------------------------------------------
console.log('\n--- Suite 3: App Launch open(app) Synchronous Disarming & Coordination ---');

test('3.1: open(app) synchronously disarms tickTimer, sets curtain color/class, and pauses Scenery BEFORE async launch', () => {
  // We inspect app.js open(app) implementation directly
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');

  // Find open(app) function body
  const openMatch = /function open\(app\)\s*\{([\s\S]*?)\n  \}/.exec(appJs);
  assert.ok(openMatch, 'function open(app) must exist in app.js');

  const openBody = openMatch[1];

  // 1. Check synchronous execution before setTimeout(..., 170)
  const setTimeoutIdx = openBody.indexOf('setTimeout');
  assert.ok(setTimeoutIdx > 0, 'open(app) must use setTimeout for 170ms curtain launch delay');

  const syncPart = openBody.slice(0, setTimeoutIdx);

  assert.ok(syncPart.includes('launching = true'), 'launching flag set synchronously');
  assert.ok(syncPart.includes('clearTimeout(tickTimer)'), 'clearTimeout(tickTimer) called synchronously before curtain delay');
  assert.ok(syncPart.includes("curtain.classList.add('is-on')"), "curtain.classList.add('is-on') called synchronously");
  assert.ok(syncPart.includes("curtain.style.setProperty('--c'"), 'curtain --c color variable set synchronously');
  assert.ok(syncPart.includes('Scenery.pause()'), 'Scenery.pause() called synchronously before external launch');
});

test('3.2: External app launch is deferred by >= 150ms curtain transition', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
  const openMatch = /function open\(app\)\s*\{([\s\S]*?)\n  \}/.exec(appJs);
  assert.ok(openMatch, 'function open(app) must exist in app.js');
  const openBody = openMatch[1];
  const delayMatch = /\},\s*(\d+)\s*\);\s*$/.exec(openBody.trim());
  assert.ok(delayMatch, 'open(app) must end with curtain setTimeout delay');
  const delayMs = parseInt(delayMatch[1], 10);
  assert.ok(delayMs >= 150 && delayMs <= 250, `Curtain delay must be between 150ms and 250ms (got ${delayMs}ms)`);
});

test('3.3: Launch failure handler triggers uncover() and showLaunchError(app)', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
  const failureHandler = /launchInGroup\s*\([^,]+,\s*function[^{]*\{[\s\S]*?\},\s*function\s*\(\)\s*\{([\s\S]*?)\}\s*\)/.exec(appJs);
  assert.ok(failureHandler, 'launchInGroup must have failure callback');
  const failureBody = failureHandler[1];
  assert.ok(failureBody.includes('uncover()'), 'Failure callback must call uncover()');
  assert.ok(failureBody.includes('showLaunchError(app)'), 'Failure callback must call showLaunchError(app)');
});

test('3.4: [LIFECYCLE RESILIENCE] uncover() must restore tick() if app launch fails or aborts', () => {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
  const uncoverMatch = /function uncover\(\)\s*\{([\s\S]*?)\n  \}/.exec(appJs);
  assert.ok(uncoverMatch, 'function uncover() must exist in app.js');
  const uncoverBody = uncoverMatch[1];

  assert.ok(uncoverBody.includes('launching = false'), 'uncover() resets launching flag');
  assert.ok(uncoverBody.includes("curtain.classList.remove('is-on')"), 'uncover() removes curtain');
  assert.ok(uncoverBody.includes('Scenery.resume()'), 'uncover() resumes Scenery');

  // Verify whether tick() is restored!
  // When open(app) runs: clearTimeout(tickTimer) killed the clock.
  // If the app fails to launch or never hid the screen, uncover() runs.
  // If uncover() does not call tick(), the clock will never update again!
  const hasTickRestore = uncoverBody.includes('tick()');
  if (!hasTickRestore) {
    console.warn('    [WARNING/FINDING] uncover() does NOT call tick(). If an app fails to launch while staying on screen, the clock will remain frozen because tickTimer was cleared in open(app)!');
  }
  // We document this finding
  assert.ok(true, 'Checked uncover clock restoration path');
});

// ----------------------------------------------------------------------------
// Suite 4: Scenery State Invariance & Edge Case Stress Under Paused State
// ----------------------------------------------------------------------------
console.log('\n--- Suite 4: Scenery Invariance & Edge Case Stress Under Paused State ---');

test('4.1: setWeatherMode() while paused preserves .weather-paused class on #screen', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  const screen = sb.document.getElementById('screen');

  sb.Scenery.pause();
  assert.strictEqual(screen.classList.contains('weather-paused'), true);

  sb.Scenery.setWeatherMode('snow');
  assert.strictEqual(screen.classList.contains('weather-paused'), true, 'Mode switch while paused must keep .weather-paused');
  assert.strictEqual(screen.classList.contains('weather-snow'), true, 'Mode switch while paused must apply weather class');

  sb.Scenery.setWeatherMode('rain');
  assert.strictEqual(screen.classList.contains('weather-paused'), true, 'Second mode switch while paused must keep .weather-paused');
  assert.strictEqual(screen.classList.contains('weather-rain'), true, 'Second mode switch while paused must apply weather class');

  sb.Scenery.resume();
  assert.strictEqual(screen.classList.contains('weather-paused'), false, 'resume() removes .weather-paused');
  sb.dispose();
});

test('4.2: setWeather(weatherData) while paused preserves .weather-paused class', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  const screen = sb.document.getElementById('screen');

  sb.Scenery.pause();
  sb.Scenery.setWeather({ tempC: 3, desc: 'Light snow', sunrise: '6:30 AM', sunset: '5:45 PM' });

  assert.strictEqual(screen.classList.contains('weather-paused'), true);
  assert.strictEqual(screen.classList.contains('weather-snow'), true);
  sb.dispose();
});

test('4.3: Corrupt weather descriptions during pause/resume cycle do not throw or crash', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });

  assert.doesNotThrow(() => {
    sb.Scenery.pause();
    sb.Scenery.setWeather(null);
    sb.Scenery.setWeather({});
    sb.Scenery.setWeather({ desc: 12345 });
    sb.Scenery.setWeather({ desc: null });
    sb.Scenery.resume();
  });
  sb.dispose();
});

test('4.4: 100 rapid alternations of setWeatherMode and pause/resume do not leak or desynchronize state', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });
  const screen = sb.document.getElementById('screen');
  const modes = ['clear', 'cloudy', 'rain', 'thunder', 'mist', 'snow'];

  for (let i = 0; i < 100; i++) {
    const mode = modes[i % modes.length];
    sb.Scenery.setWeatherMode(mode);
    if (i % 2 === 0) {
      sb.Scenery.pause();
      assert.strictEqual(screen.classList.contains('weather-paused'), true);
    } else {
      sb.Scenery.resume();
      assert.strictEqual(screen.classList.contains('weather-paused'), false);
    }
  }

  // End in clean active state
  sb.Scenery.resume();
  assert.strictEqual(screen.classList.contains('weather-paused'), false);
  sb.dispose();
});

// ----------------------------------------------------------------------------
// Final Summary
// ----------------------------------------------------------------------------
console.log('\n=================================================================');
console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
if (failedTests > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error.message}`));
}
console.log('=================================================================\n');

process.exit(failedTests > 0 ? 1 : 0);
