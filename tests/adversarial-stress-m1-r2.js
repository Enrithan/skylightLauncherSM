/**
 * Adversarial Stress Test Suite for Milestone 1 Iteration 2 (Challenger 1)
 * Target Areas:
 * 1. Non-string weather descriptions in classifyWeather and normalizeWeatherMode
 * 2. Numeric and corrupt sunrise/sunset values in parseAstroHours
 * 3. Degenerate SUNRISE == SUNSET / SUNRISE > SUNSET in placeBodies(now)
 * 4. Case-insensitive query parameter previews (?WEATHER=rain, ?weather=RAIN, ?Weather=THUNDER)
 * 5. Unknown weather modes class list sanitation and fallback
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const {
  INDEX_HTML_PATH,
  SCENERY_JS_PATH,
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

console.log('=== ADVERSARIAL STRESS TEST SUITE: M1 R2 CHALLENGER ===\n');

// ----------------------------------------------------------------------------
// Target 1: Non-string weather descriptions in classifyWeather and normalizeWeatherMode
// ----------------------------------------------------------------------------
console.log('--- Target 1: Non-string descriptions in classifyWeather & normalizeWeatherMode ---');

const nonStringInputs = [
  12345,
  0,
  -1,
  NaN,
  Infinity,
  -Infinity,
  true,
  false,
  {},
  { desc: 'rain' },
  [],
  ['thunder'],
  null,
  undefined,
  Symbol('storm'),
  function() { return 'rain'; },
  /rain/,
  new Date(),
  new Error('weather error')
];

nonStringInputs.forEach(input => {
  const display = typeof input === 'symbol' ? 'Symbol(storm)' :
                  typeof input === 'function' ? 'function()' :
                  JSON.stringify(input);

  test(`1.classifyWeather(${display}) handles safely without throw and returns valid mode`, () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    // Note: classifyWeather may handle symbols via try/catch or string coercion; test behavior:
    let res;
    if (typeof input === 'symbol') {
      // Symbol cannot be implicitly coerced via String(input || '') or string concatenation if undefined
      try {
        res = sb.Scenery.classifyWeather(input);
      } catch (e) {
        // symbols can throw on coercion unless checked, let's see how scenery handles it
        throw new Error(`Symbol threw: ${e.message}`);
      }
    } else {
      res = sb.Scenery.classifyWeather(input);
    }
    assert.strictEqual(typeof res, 'string', `Result must be string, got ${typeof res}`);
    const validModes = ['clear', 'cloudy', 'rain', 'thunder', 'fog', 'mist', 'snow'];
    assert.ok(validModes.includes(res), `classifyWeather must return valid mode, got ${res}`);
    sb.dispose();
  });

  test(`1.setWeather({ desc: ${display} }) sets clean weather mode without throwing`, () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    if (typeof input === 'symbol') {
      try {
        sb.Scenery.setWeather({ desc: input, tempC: 22 });
      } catch (e) {
        throw new Error(`Symbol threw: ${e.message}`);
      }
    } else {
      sb.Scenery.setWeather({ desc: input, tempC: 22 });
    }

    const mode = sb.Scenery.getWeatherMode();
    const validModes = ['clear', 'cloudy', 'rain', 'thunder', 'fog', 'mist', 'snow'];
    assert.ok(validModes.includes(mode), `getWeatherMode returned invalid mode: ${mode}`);
    const screen = sb.document.getElementById('screen');
    assert.ok(screen.classList.contains('weather-' + mode), `Screen must have class weather-${mode}`);
    sb.dispose();
  });

  test(`1.setWeatherMode(${display}) handles safely and sets valid weather mode`, () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    if (typeof input === 'symbol') {
      try {
        sb.Scenery.setWeatherMode(input);
      } catch (e) {
        throw new Error(`Symbol threw: ${e.message}`);
      }
    } else {
      sb.Scenery.setWeatherMode(input);
    }

    const mode = sb.Scenery.getWeatherMode();
    const validModes = ['clear', 'cloudy', 'rain', 'thunder', 'fog', 'mist', 'snow'];
    assert.ok(validModes.includes(mode), `getWeatherMode returned invalid mode: ${mode}`);
    sb.dispose();
  });
});

// ----------------------------------------------------------------------------
// Target 2: Numeric and corrupt sunrise/sunset values in parseAstroHours
// ----------------------------------------------------------------------------
console.log('\n--- Target 2: Numeric and corrupt sunrise/sunset values in parseAstroHours ---');

const astroTestInputs = [
  // Numeric values
  { sunrise: 6.5, sunset: 18.25, label: 'Float numbers' },
  { sunrise: 0, sunset: 23.9, label: 'Midnight bounds (0 and 23.9)' },
  { sunrise: -5, sunset: 30, label: 'Out of range negative/excessive numbers' },
  { sunrise: NaN, sunset: Infinity, label: 'NaN and Infinity' },
  { sunrise: -Infinity, sunset: NaN, label: '-Infinity and NaN' },
  // String variations
  { sunrise: '06:30 AM', sunset: '08:45 PM', label: 'Standard 12h AM/PM strings' },
  { sunrise: '6:30am', sunset: '8:45pm', label: 'Lowercase 12h am/pm strings' },
  { sunrise: '12:00 AM', sunset: '12:00 PM', label: 'Noon/midnight 12h strings' },
  { sunrise: '06:30', sunset: '20:45', label: '24h time strings without AM/PM' },
  { sunrise: '99:99', sunset: '88:88 PM', label: 'Nonsense hour/min values in format' },
  { sunrise: 'invalid', sunset: 'corrupt_string', label: 'Completely unparseable strings' },
  { sunrise: '', sunset: '   ', label: 'Empty and whitespace strings' },
  { sunrise: null, sunset: undefined, label: 'null and undefined' },
  { sunrise: {}, sunset: [], label: 'Object and Array' },
  { sunrise: true, sunset: false, label: 'Booleans' }
];

astroTestInputs.forEach(({ sunrise, sunset, label }) => {
  test(`2.setWeather with ${label} (sunrise=${sunrise}, sunset=${sunset}) parses safely without throw`, () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({
        desc: 'Clear',
        sunrise: sunrise,
        sunset: sunset,
        tempC: 20
      });
      // also trigger update/placeBodies
      sb.Scenery.update(new Date(2026, 9, 29, 12, 0, 0));
    });
    sb.dispose();
  });
});

// ----------------------------------------------------------------------------
// Target 3: Degenerate SUNRISE == SUNSET / SUNRISE > SUNSET in placeBodies(now)
// ----------------------------------------------------------------------------
console.log('\n--- Target 3: Degenerate SUNRISE == SUNSET in placeBodies(now) ---');

const degenerateAstroCases = [
  { sunrise: 6.0, sunset: 6.0, desc: 'Exact equal at 6.0' },
  { sunrise: 0.0, sunset: 0.0, desc: 'Exact equal at midnight 0.0' },
  { sunrise: 12.0, sunset: 12.0, desc: 'Exact equal at noon 12.0' },
  { sunrise: 23.99, sunset: 23.99, desc: 'Exact equal at day end 23.99' },
  { sunrise: '06:00 AM', sunset: '06:00 AM', desc: 'Exact equal strings 06:00 AM' },
  { sunrise: 20.0, sunset: 6.0, desc: 'Inverted SUNRISE (20.0) > SUNSET (6.0) (span <= 0)' },
  { sunrise: '09:00 PM', sunset: '05:00 AM', desc: 'Inverted strings 9 PM sunrise, 5 AM sunset' }
];

degenerateAstroCases.forEach(({ sunrise, sunset, desc }) => {
  test(`3. Degenerate astro: ${desc} does not produce NaN coordinates or CSS values`, () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    sb.Scenery.setWeather({
      desc: 'Clear',
      sunrise: sunrise,
      sunset: sunset,
      tempC: 20
    });

    // Test multiple times of day: midnight, morning, noon, evening, night
    const testHours = [0, 3, 6, 9, 12, 15, 18, 21, 23.5];
    const glare = sb.document.getElementById('glare');
    const moon = sb.document.getElementById('moon');
    const lake = sb.document.getElementById('lake');
    const haze = sb.document.getElementById('haze');

    testHours.forEach(h => {
      const d = new Date(2026, 9, 29, Math.floor(h), Math.round((h % 1) * 60), 0);
      sb.Scenery.update(d);

      // Verify glare transform
      const glareTransform = glare.style.transform;
      assert.ok(glareTransform, `glare.style.transform must be set at hour ${h}`);
      assert.ok(!glareTransform.includes('NaN'), `glare transform contains NaN at hour ${h}: ${glareTransform}`);
      assert.ok(!glareTransform.includes('undefined'), `glare transform contains undefined at hour ${h}`);

      // Verify moon transform
      const moonTransform = moon.style.transform;
      assert.ok(moonTransform, `moon.style.transform must be set at hour ${h}`);
      assert.ok(!moonTransform.includes('NaN'), `moon transform contains NaN at hour ${h}: ${moonTransform}`);

      // Verify haze transform
      const hazeTransform = haze.style.transform;
      assert.ok(!hazeTransform.includes('NaN'), `haze transform contains NaN at hour ${h}: ${hazeTransform}`);

      // Verify lake property --refl-x
      const reflX = lake.style.getPropertyValue('--refl-x');
      assert.ok(reflX, `lake --refl-x must be set at hour ${h}`);
      assert.ok(!reflX.includes('NaN'), `lake --refl-x contains NaN at hour ${h}: ${reflX}`);
    });

    sb.dispose();
  });
});

// ----------------------------------------------------------------------------
// Target 4: Case-insensitive query parameter previews
// ----------------------------------------------------------------------------
console.log('\n--- Target 4: Case-insensitive query parameter previews ---');

const queryParamCases = [
  { search: '?WEATHER=rain', expectedMode: 'rain', desc: 'All uppercase key and value ?WEATHER=rain' },
  { search: '?weather=RAIN', expectedMode: 'rain', desc: 'Lowercase key, uppercase value ?weather=RAIN' },
  { search: '?Weather=THUNDER', expectedMode: 'thunder', desc: 'Capitalized key, uppercase value ?Weather=THUNDER' },
  { search: '?WEATHER=SNOW', expectedMode: 'snow', desc: 'All uppercase ?WEATHER=SNOW' },
  { search: '?weather=snOw', expectedMode: 'snow', desc: 'Mixed case value ?weather=snOw' },
  { search: '?WeAtHeR=FoG', expectedMode: 'fog', desc: 'Alternating key/val ?WeAtHeR=FoG' },
  { search: '?weather=CLOUDY', expectedMode: 'cloudy', desc: 'Uppercase value ?weather=CLOUDY' },
  { search: '?WEATHER=clear', expectedMode: 'clear', desc: 'Uppercase key, lowercase val ?WEATHER=clear' },
  { search: '?hour=12&WEATHER=rain', expectedMode: 'rain', desc: 'Second parameter ?hour=12&WEATHER=rain' },
  { search: '?WEATHER=THUNDER&still=1', expectedMode: 'thunder', desc: 'Leading parameter ?WEATHER=THUNDER&still=1' }
];

queryParamCases.forEach(({ search, expectedMode, desc }) => {
  test(`4. Case-insensitivity: ${desc} correctly activates weather-${expectedMode}`, () => {
    const sb = createSandbox(htmlContent, { search: search });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    const activeMode = sb.Scenery.getWeatherMode();
    assert.strictEqual(activeMode, expectedMode, `getWeatherMode must be ${expectedMode}, got ${activeMode}`);

    const screen = sb.document.getElementById('screen');
    assert.ok(
      screen.classList.contains('weather-' + expectedMode),
      `#screen must have class weather-${expectedMode}. Classes: ${screen.classList.toString()}`
    );
    sb.dispose();
  });
});

// ----------------------------------------------------------------------------
// Target 5: Unknown weather modes and class list sanitation
// ----------------------------------------------------------------------------
console.log('\n--- Target 5: Unknown weather modes & class list cleanliness ---');

const rogueModes = [
  'tornado',
  'hurricane',
  'alien',
  'volcano',
  'sandstorm',
  'typhoon',
  'nuclear_winter',
  '<script>',
  'weather-hack',
  'null',
  'undefined',
  '12345'
];

rogueModes.forEach(rogue => {
  test(`5. setWeatherMode('${rogue}') falls back to clear and sanitizes class list`, () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    // First put it in rain mode
    sb.Scenery.setWeatherMode('rain');
    const screen = sb.document.getElementById('screen');
    assert.ok(screen.classList.contains('weather-rain'));

    // Now inject rogue mode
    sb.Scenery.setWeatherMode(rogue);

    // Weather mode should safely be 'clear'
    const currentMode = sb.Scenery.getWeatherMode();
    assert.strictEqual(currentMode, 'clear', `Unknown mode '${rogue}' must fallback to 'clear', got '${currentMode}'`);

    // Verify class list: MUST have weather-clear, MUST NOT have weather-rain, and MUST NOT have weather-<rogue>
    assert.ok(screen.classList.contains('weather-clear'), `Screen must contain weather-clear`);
    assert.ok(!screen.classList.contains('weather-rain'), `Screen must NOT contain weather-rain`);
    assert.ok(!screen.classList.contains('weather-' + rogue), `Screen must NOT contain rogue class weather-${rogue}`);

    // Verify no rogue weather- classes except weather-clear (or weather-paused if paused)
    const tokens = screen.classList.toString().split(/\s+/);
    tokens.forEach(cls => {
      if (cls && cls.startsWith('weather-') && cls !== 'weather-paused') {
        assert.strictEqual(cls, 'weather-clear', `Found unauthorized weather class: ${cls}`);
      }
    });

    sb.dispose();
  });

  test(`5. Query param preview with unknown mode '?weather=${rogue}' cleans class list`, () => {
    const sb = createSandbox(htmlContent, { search: `?weather=${rogue}` });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });

    const screen = sb.document.getElementById('screen');
    const mode = sb.Scenery.getWeatherMode();
    assert.strictEqual(mode, 'clear', `Query param with '${rogue}' must fallback to 'clear'`);
    assert.ok(screen.classList.contains('weather-clear'), `Screen must have weather-clear`);
    assert.ok(!screen.classList.contains('weather-' + rogue), `Screen must NOT contain weather-${rogue}`);

    const tokens = screen.classList.toString().split(/\s+/);
    tokens.forEach(cls => {
      if (cls && cls.startsWith('weather-') && cls !== 'weather-paused') {
        assert.strictEqual(cls, 'weather-clear', `Found unauthorized weather class from query param: ${cls}`);
      }
    });

    sb.dispose();
  });
});

// Also test class list purging if someone manually added rogue classes
test('5. applyWeatherMode actively strips pre-existing rogue weather-* classes', () => {
  const sb = createSandbox(htmlContent);
  vm.runInContext(sceneryJsContent, sb);
  sb.Scenery.init({ lean: false });

  const screen = sb.document.getElementById('screen');
  screen.classList.add('weather-alien');
  screen.classList.add('weather-superstorm');
  screen.classList.add('weather-paused'); // this one should be preserved if present
  screen.classList.add('is-live');

  // Trigger weather mode change
  sb.Scenery.setWeatherMode('rain');

  assert.ok(!screen.classList.contains('weather-alien'), 'weather-alien must be purged');
  assert.ok(!screen.classList.contains('weather-superstorm'), 'weather-superstorm must be purged');
  assert.ok(screen.classList.contains('weather-rain'), 'weather-rain must be added');
  assert.ok(screen.classList.contains('weather-paused'), 'weather-paused must NOT be purged');
  assert.ok(screen.classList.contains('is-live'), 'is-live must be preserved');

  sb.dispose();
});

console.log(`\n==================================================`);
console.log(`RESULTS: Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
if (failedTests > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(` - ${f.name}: ${f.error.message}`));
  process.exit(1);
} else {
  console.log('ALL ADVERSARIAL STRESS TESTS PASSED!');
  process.exit(0);
}
