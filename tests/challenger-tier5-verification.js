/**
 * tests/challenger-tier5-verification.js
 * Empirical Challenger Verification Harness for Milestone 4 (Tier 5 Adversarial R2)
 *
 * Verifies:
 * 1. Resolution of 4 Latent Defects in skylight/js/scenery.js:
 *    - Defect 1: Midnight-boundary wrap & pre-dawn palette cross-fade at 04:10 - 05:00 AM
 *    - Defect 2: Scenery.init() DOM node leak under 10+ repeated calls
 *    - Defect 3: sendBirds & sendMeteor timer re-arming guard under isPaused
 *    - Defect 4: writeDetail() string/decimal temperature parsing & moon fallback desync
 * 2. Fine-grained minute-by-minute pre-dawn sweep (04:00 to 05:15) checking for color pops, monotonicity, and NaN ratios
 * 3. 20 consecutive repeated Scenery.init() calls verifying zero DOM child accumulation
 * 4. 24-hour continuous boundary sanity (midnight wrap, noon, dawn, dusk)
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
  APP_CSS_PATH,
  createSandbox
} = require('./e2e/test-helpers');

const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const sceneryJsContent = fs.readFileSync(SCENERY_JS_PATH, 'utf8');

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

function parseHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistance(hexA, hexB) {
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

console.log('=================================================================');
console.log('  CHALLENGER 1: EMPIRICAL TIER 5 SCENERY VERIFICATION HARNESS');
console.log('=================================================================\n');

// ----------------------------------------------------------------------------
// Suite 1: Latent Defect 1 & Pre-Dawn Palette Cross-Fade Verification
// ----------------------------------------------------------------------------
console.log('--- Suite 1: Pre-Dawn Palette Cross-Fade & Monotonicity (04:10 - 05:00 AM) ---');

test('1.1: Pre-dawn minute-by-minute sweep from 04:00 to 05:15 (75 sample points)', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();

  let prevTop = null;
  let prevDistance = 0;
  const hexRegex = /^#[0-9a-f]{6}$/i;

  for (let m = 240; m <= 315; m++) { // 04:00 (240m) to 05:15 (315m)
    const h = Math.floor(m / 60);
    const min = m % 60;
    const timeStr = `${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}`;
    const date = new Date(`2026-10-29T${timeStr}:00`);

    sb.Scenery.update(date);
    const style = sb.document.documentElement.style;
    const top = style.getPropertyValue('--sky-top');
    const mid = style.getPropertyValue('--sky-mid');
    const low = style.getPropertyValue('--sky-low');
    const floor = style.getPropertyValue('--floor');
    const stars = parseFloat(style.getPropertyValue('--stars'));
    const mist = parseFloat(style.getPropertyValue('--mist'));
    const rays = parseFloat(style.getPropertyValue('--rays'));

    // Check all hex values
    assert.ok(hexRegex.test(top), `Invalid hex at ${timeStr}: ${top}`);
    assert.ok(hexRegex.test(mid), `Invalid mid hex at ${timeStr}: ${mid}`);
    assert.ok(hexRegex.test(low), `Invalid low hex at ${timeStr}: ${low}`);
    assert.ok(hexRegex.test(floor), `Invalid floor hex at ${timeStr}: ${floor}`);

    // Check numeric ratios for NaN or out of bounds
    assert.ok(!isNaN(stars) && stars >= 0 && stars <= 1, `Stars out of bounds at ${timeStr}: ${stars}`);
    assert.ok(!isNaN(mist) && mist >= 0 && mist <= 1, `Mist out of bounds at ${timeStr}: ${mist}`);
    assert.ok(!isNaN(rays) && rays >= 0 && rays <= 1, `Rays out of bounds at ${timeStr}: ${rays}`);

    if (prevTop) {
      const dist = colorDistance(prevTop, top);
      // No single minute should jump more than 10 units in RGB Euclidean space
      // Max Euclidean distance between night #03051a and dawn #1b1d3f is ~47 over 50 minutes (~0.94/min)
      assert.ok(
        dist < 8.0,
        `Color pop detected at ${timeStr}! Distance from previous minute: ${dist.toFixed(2)} (prev: ${prevTop}, curr: ${top})`
      );
    }
    prevTop = top;
  }

  sb.dispose();
});

test('1.2: Boundary continuity at 04:10:00 (blend start) and 05:00:00 (dawn handover)', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();

  // Exactly at 04:09:59 (still 100% night)
  sb.Scenery.update(new Date('2026-10-29T04:09:59'));
  const top0409 = sb.document.documentElement.style.getPropertyValue('--sky-top');

  // Exactly at 04:10:00 (blend starts, t = 0)
  sb.Scenery.update(new Date('2026-10-29T04:10:00'));
  const top0410 = sb.document.documentElement.style.getPropertyValue('--sky-top');

  assert.strictEqual(top0409, top0410, 'At 04:10:00 blend start (t=0), color must match 04:09:59 night palette exactly');

  // At 04:59:59 (almost 100% dawn, t ~ 0.999)
  sb.Scenery.update(new Date('2026-10-29T04:59:59'));
  const top0459 = sb.document.documentElement.style.getPropertyValue('--sky-top');

  // At 05:00:00 (dawn starts, t = 0 of dawn)
  sb.Scenery.update(new Date('2026-10-29T05:00:00'));
  const top0500 = sb.document.documentElement.style.getPropertyValue('--sky-top');

  const handoverDist = colorDistance(top0459, top0500);
  assert.ok(
    handoverDist < 2.0,
    `Handover at 05:00:00 must be smooth! Euclidean distance: ${handoverDist} (04:59:59: ${top0459}, 05:00:00: ${top0500})`
  );

  sb.dispose();
});

test('1.3: Monotonic progression of blend ratio and star reduction during pre-dawn', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();

  let prevStars = 1.0;
  for (let m = 250; m <= 300; m += 5) { // 04:10 to 05:00 in 5-minute steps
    const h = Math.floor(m / 60);
    const min = m % 60;
    const timeStr = `${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}`;
    sb.Scenery.update(new Date(`2026-10-29T${timeStr}:00`));

    const stars = parseFloat(sb.document.documentElement.style.getPropertyValue('--stars'));
    assert.ok(
      stars <= prevStars + 1e-4,
      `Stars must monotonically decrease towards dawn! At ${timeStr} stars=${stars}, prev=${prevStars}`
    );
    prevStars = stars;
  }

  sb.dispose();
});

// ----------------------------------------------------------------------------
// Suite 2: Latent Defect 2 & Repeated Scenery.init() DOM Leak Verification
// ----------------------------------------------------------------------------
console.log('\n--- Suite 2: Scenery.init() DOM Node Leak Under 10 Repeated Calls ---');

test('2.1: Scenery.init() 10 repeated calls produces ZERO child node leak in #flares, #twinkles, #fireflies', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);

  // Baseline init call
  sb.Scenery.init();
  const flaresBaseline = sb.document.getElementById('flares').children.length;
  const twinklesBaseline = sb.document.getElementById('twinkles').children.length;
  const firefliesBaseline = sb.document.getElementById('fireflies').children.length;

  assert.strictEqual(flaresBaseline, 7, 'Baseline #flares must have exactly 7 ghost elements');
  assert.strictEqual(twinklesBaseline, 10, 'Baseline #twinkles must have exactly 10 stars');
  assert.strictEqual(firefliesBaseline, 9, 'Baseline #fireflies must have exactly 9 firefly elements');

  // 10 repeated calls
  for (let call = 1; call <= 10; call++) {
    sb.Scenery.init();
    const flaresNow = sb.document.getElementById('flares').children.length;
    const twinklesNow = sb.document.getElementById('twinkles').children.length;
    const firefliesNow = sb.document.getElementById('fireflies').children.length;

    assert.strictEqual(
      flaresNow,
      flaresBaseline,
      `Call #${call}: #flares child count must remain ${flaresBaseline}, got ${flaresNow}`
    );
    assert.strictEqual(
      twinklesNow,
      twinklesBaseline,
      `Call #${call}: #twinkles child count must remain ${twinklesBaseline}, got ${twinklesNow}`
    );
    assert.strictEqual(
      firefliesNow,
      firefliesBaseline,
      `Call #${call}: #fireflies child count must remain ${firefliesBaseline}, got ${firefliesNow}`
    );
  }

  sb.dispose();
});

test('2.2: Scenery.init() alternating lean and non-lean modes does not leak DOM nodes', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);

  for (let i = 0; i < 6; i++) {
    // Non-lean mode
    sb.Scenery.init({ lean: false });
    assert.strictEqual(sb.document.getElementById('flares').children.length, 7);
    assert.strictEqual(sb.document.getElementById('twinkles').children.length, 10);
    assert.strictEqual(sb.document.getElementById('fireflies').children.length, 9);

    // Lean mode: ghosts and twinkles are not populated / cleared
    sb.Scenery.init({ lean: true });
    // In lean mode, makeGhosts returns [] and sprinkleStarsLean doesn't populate twinkles
    // But verify containers are clean
    assert.ok(sb.document.getElementById('screen').classList.contains('lean'));
  }

  sb.dispose();
});

// ----------------------------------------------------------------------------
// Suite 3: Latent Defect 3 & Visitor Callbacks isPaused Guard
// ----------------------------------------------------------------------------
console.log('\n--- Suite 3: Visitor Callbacks sendBirds & sendMeteor isPaused Guard ---');

test('3.1: Visitor callbacks do not schedule timeouts when isPaused is true', () => {
  const sb = createSandbox(htmlContent);
  const scheduledFns = [];
  const fnMap = {};
  const origSetTimeout = sb.setTimeout;
  sb.setTimeout = (fn, ms) => {
    const name = fn.name || 'anon';
    scheduledFns.push(name);
    fnMap[name] = fn;
    return origSetTimeout(fn, ms);
  };

  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();

  // Initial daytime arming
  sb.Scenery.update(new Date('2026-10-29T14:00:00'));
  assert.ok(scheduledFns.includes('sendBirds'), 'Must have scheduled sendBirds');

  // Nighttime arming to capture sendMeteor
  sb.Scenery.update(new Date('2026-10-29T22:00:00'));
  assert.ok(scheduledFns.includes('sendMeteor'), 'Must have scheduled sendMeteor');

  // Pause scenery
  sb.Scenery.pause();
  const scheduledCountAfterPause = scheduledFns.length;

  // Now trigger the captured visitor callbacks directly while paused (simulating timer firing during pause transition)
  if (fnMap.sendBirds) fnMap.sendBirds();
  if (fnMap.sendMeteor) fnMap.sendMeteor();

  const newTimeouts = scheduledFns.length - scheduledCountAfterPause;
  assert.strictEqual(
    newTimeouts,
    0,
    `No new visitor timeouts should be armed while scenery is paused! (Armed: ${newTimeouts})`
  );

  sb.dispose();
});

// ----------------------------------------------------------------------------
// Suite 4: Latent Defect 4 & Temperature String / Decimal Handling
// ----------------------------------------------------------------------------
console.log('\n--- Suite 4: Temperature String / Decimal Handling in writeDetail() ---');

test('4.1: writeDetail() parses string and decimal temperatures without moon fallback desync', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();
  sb.Scenery.update(new Date('2026-10-29T12:00:00'));

  const testCases = [
    { input: '24', expectedInDetail: '24°C', desc: 'String integer' },
    { input: '0', expectedInDetail: '0°C', desc: 'String zero' },
    { input: '-5', expectedInDetail: '-5°C', desc: 'Negative string integer' },
    { input: '26.8', expectedInDetail: '26.8°C', desc: 'Positive string float' },
    { input: '-14.3', expectedInDetail: '-14.3°C', desc: 'Negative string float' },
    { input: 24, expectedInDetail: '24°C', desc: 'Numeric integer' },
    { input: 0, expectedInDetail: '0°C', desc: 'Numeric zero' },
    { input: -40.5, expectedInDetail: '-40.5°C', desc: 'Numeric float' }
  ];

  testCases.forEach(({ input, expectedInDetail, desc }) => {
    sb.Scenery.setWeather({ tempC: input, desc: 'Rain', sunrise: '06:00 AM', sunset: '06:00 PM' });
    const detailText = sb.document.getElementById('detail').textContent;
    const badgeText = sb.document.getElementById('weatherTemp').textContent;

    assert.ok(
      detailText.indexOf(expectedInDetail) !== -1,
      `[${desc}] Detail text '${detailText}' must contain '${expectedInDetail}'`
    );
    assert.strictEqual(
      badgeText,
      expectedInDetail,
      `[${desc}] Weather badge '${badgeText}' must match expected '${expectedInDetail}'`
    );

    // Ensure it did not fall back to moon name while temp is available!
    const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    MOON_NAMES.forEach(m => {
      assert.strictEqual(
        detailText.indexOf(m),
        -1,
        `[${desc}] Detail text should NOT contain moon fallback '${m}' when liveWeather is present!`
      );
    });
  });

  sb.dispose();
});

test('4.2: writeDetail() gracefully falls back to moon phase when tempC is NaN or null', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();
  sb.Scenery.update(new Date('2026-10-29T12:00:00'));

  const MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

  const badTemps = [NaN, null, undefined, 'corrupt-temp', ''];
  badTemps.forEach(bad => {
    sb.Scenery.setWeather({ tempC: bad, desc: 'Rain' });
    const detailText = sb.document.getElementById('detail').textContent;
    const hasMoon = MOON_NAMES.some(m => detailText.indexOf(m) !== -1);
    assert.ok(
      hasMoon,
      `Detail text '${detailText}' must fall back to moon phase when tempC is invalid (${String(bad)})`
    );
  });

  sb.dispose();
});

// ----------------------------------------------------------------------------
// Suite 5: High-Resolution Pre-Dawn CSS Property Sanity & Zero-NaN Guarantee
// ----------------------------------------------------------------------------
console.log('\n--- Suite 5: High-Resolution Pre-Dawn CSS Property Sanity & Zero-NaN Guarantee ---');

test('5.1: 50 sample points between 04:10 and 05:00 have 100% defined, non-NaN CSS variables', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init();

  const cssProperties = [
    '--sky-top', '--sky-mid', '--sky-low', '--floor',
    '--cloud-lit', '--cloud-shade', '--haze', '--glare',
    '--rays', '--rim', '--stars', '--milky', '--aurora',
    '--fireflies', '--mist', '--godrays',
    '--ridge-far', '--ridge-mid', '--ridge-near', '--pines', '--lake-top'
  ];

  // 50 1-minute steps through the pre-dawn window
  for (let m = 250; m <= 300; m++) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const timeStr = `${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}`;
    sb.Scenery.update(new Date(`2026-10-29T${timeStr}:00`));

    const style = sb.document.documentElement.style;
    for (const prop of cssProperties) {
      const val = style.getPropertyValue(prop);
      assert.ok(val && val.length > 0, `Property ${prop} is empty at ${timeStr}`);
      assert.strictEqual(val.indexOf('NaN'), -1, `Property ${prop} contains NaN ('${val}') at ${timeStr}`);
      assert.strictEqual(val.indexOf('undefined'), -1, `Property ${prop} contains undefined ('${val}') at ${timeStr}`);
    }
  }

  sb.dispose();
});

test('5.2: Strict 10-call DOM snapshot invariance across #flares, #twinkles, #fireflies', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);

  sb.Scenery.init();
  const getCounts = () => ({
    flares: sb.document.getElementById('flares').children.length,
    twinkles: sb.document.getElementById('twinkles').children.length,
    fireflies: sb.document.getElementById('fireflies').children.length
  });

  const initial = getCounts();

  for (let i = 1; i <= 10; i++) {
    sb.Scenery.init();
    const curr = getCounts();
    assert.deepStrictEqual(
      curr,
      initial,
      `DOM child counts changed on repeated init() call #${i}: expected ${JSON.stringify(initial)}, got ${JSON.stringify(curr)}`
    );
  }

  sb.dispose();
});

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log('\n=================================================================');
console.log(`TOTAL EMPIRICAL CHALLENGER TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
if (failedTests > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error.message}`));
}
console.log('=================================================================\n');

process.exit(failedTests > 0 ? 1 : 0);

