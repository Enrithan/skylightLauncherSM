/**
 * tests/adversarial-tier5-scenery.js
 * Tier 5 Adversarial Coverage Hardening Suite for Scenery Engine & CSS Layers.
 *
 * White-Box Adversarial Stress Testing:
 * 1. Astro calculations: parseAstroHours edge boundaries (12:00 AM, 12:00 PM, 00:00, 23:59).
 * 2. Astro calculations: corrupt, NaN, Infinity, null, undefined, non-string, object inputs.
 * 3. Celestial geometry: placeBodies with degenerate astronomical times (sunrise == sunset, polar night/day).
 * 4. [DEFECT 1] Palette interpolation: Midnight-boundary wrap breaks pre-dawn blend ratio (04:10 - 05:00 AM).
 * 5. Palette bounds: Complete 24-hour sweep verifying all hex colors and ratios remain in [0, 1].
 * 6. Weather classification: Real-world wttr.in & Open-Meteo 35-term condition taxonomy.
 * 7. Weather classification: Adversarial non-ASCII, Cyrillic, Chinese, pure emoji, symbols, and objects.
 * 8. Temperature boundary stress: Numeric temperatures (-50°C to +60°C, 0°C, decimals).
 * 9. [DEFECT 4] Temperature string desync: String tempC (e.g. '24') desynchronizes #weatherTemp vs #detail moon fallback.
 * 10. Weather micro-icon vector integrity: SVG contracts, viewBox '0 0 28 28', and sub-elements across all 6 modes.
 * 11. [DEFECT 2] Scenery DOM invariance: Scenery.init() non-idempotence leaking DOM child nodes across multiple calls.
 * 12. Scenery mode switching stress: 150 rapid alternating setWeatherMode() calls without class desynchronization.
 * 13. Scenery pause/resume invariance: Weather mode updates while paused preserve .weather-paused state.
 * 14. Visitor scheduling lifecycle: Day (sendBirds) vs Night (sendMeteor) timer arming and pause clearing.
 * 15. [DEFECT 3] Visitor recursion isPaused guard: sendBirds and sendMeteor re-arm timers even when scenery is paused.
 * 16. CSS GPU compositing invariant: 100% of @keyframes rules animate exclusively transform and/or opacity.
 * 17. CSS zero-blur shader & zero-reflow invariant: 0 blur filters, 0 reflow properties in keyframes.
 * 18. Projector TV performance mode: Desktop layers forced display:none !important, weather-paused halts all animations.
 * 19. Headless browser CDP empirical verification: Real Chromium execution of scenery layers and transitions.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');

const {
  PROJECT_ROOT,
  INDEX_HTML_PATH,
  APP_CSS_PATH,
  SCENERY_JS_PATH,
  APP_JS_PATH,
  createSandbox,
  CSSRuleBook
} = require('./e2e/test-helpers');

const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const appCssContent = fs.readFileSync(APP_CSS_PATH, 'utf8');
const sceneryJsContent = fs.readFileSync(SCENERY_JS_PATH, 'utf8');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => {
        passedTests++;
        console.log(`  [PASS] ${name}`);
      }).catch((err) => {
        failedTests++;
        console.error(`  [FAIL] ${name}: ${err.message}`);
        failures.push({ name, error: err });
      });
    }
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failures.push({ name, error: err });
  }
}

async function runAll() {
  console.log('=================================================================');
  console.log('  TIER 5 ADVERSARIAL COVERAGE HARDENING: SCENERY & CSS LAYERS');
  console.log('=================================================================\n');

  // ==========================================================================
  // Section 1: Astro Calculations & Mathematical Robustness
  // ==========================================================================
  console.log('--- Section 1: Astro Calculations & Mathematical Robustness ---');

  test('1.1: parseAstroHours standard & 24hr edge boundaries (midnight, noon, 11:59pm, 00:00, 23:59)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();

    // 12:00 AM -> 0.0 (midnight)
    sb.Scenery.setWeather({ sunrise: '12:00 AM', sunset: '12:00 PM' });
    sb.Scenery.update(new Date('2026-10-29T00:30:00'));
    assert.strictEqual(sb.document.getElementById('glare').classList.contains('is-up'), true, 'Sun must be up between 12:00 AM and 12:00 PM');

    // 24hr format: 00:00 -> 0.0, 23:59 -> 23.983
    sb.Scenery.setWeather({ sunrise: '00:00', sunset: '23:59' });
    sb.Scenery.update(new Date('2026-10-29T12:00:00'));
    assert.strictEqual(sb.document.getElementById('glare').classList.contains('is-up'), true);

    // 11:59 PM
    sb.Scenery.setWeather({ sunrise: '06:00 AM', sunset: '11:59 PM' });
    sb.Scenery.update(new Date('2026-10-29T23:58:00'));
    assert.strictEqual(sb.document.getElementById('glare').classList.contains('is-up'), true);

    sb.dispose();
  });

  test('1.2: parseAstroHours corrupt & adversarial inputs (NaN, Infinity, null, undefined, object, symbols)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();

    const corruptInputs = [
      NaN,
      Infinity,
      -Infinity,
      null,
      undefined,
      true,
      false,
      {},
      { sunrise: '06:00' },
      [],
      '',
      'invalid-time-string',
      'abc:def PM',
      '99:99',
      '??:??'
    ];

    corruptInputs.forEach((bad, idx) => {
      assert.doesNotThrow(() => {
        sb.Scenery.setWeather({ sunrise: bad, sunset: bad });
        sb.Scenery.update(new Date('2026-10-29T12:00:00'));
      }, `Corrupt input #${idx} (${String(bad)}) must not throw error`);
    });

    sb.dispose();
  });

  test('1.3: placeBodies celestial arc under degenerate astronomical times (sunrise == sunset, polar night/day)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();

    const degenerateCases = [
      { sunrise: '06:00 AM', sunset: '06:00 AM' }, // span == 0
      { sunrise: '12:00 PM', sunset: '06:00 AM' }, // sunrise > sunset (polar/inverted)
      { sunrise: '00:00', sunset: '24:00' },       // 24hr day
      { sunrise: 6.0, sunset: 6.0 },              // numeric span == 0
      { sunrise: 22.0, sunset: 4.0 }              // night span wrap
    ];

    degenerateCases.forEach((c, idx) => {
      sb.Scenery.setWeather(c);
      // Sample 24 hourly steps
      for (let h = 0; h < 24; h++) {
        const d = new Date(`2026-10-29T${h < 10 ? '0' + h : h}:15:00`);
        assert.doesNotThrow(() => {
          sb.Scenery.update(d);
        }, `Degenerate case #${idx} at hour ${h} must calculate without crash`);

        const glareTransform = sb.document.getElementById('glare').style.transform;
        assert.ok(glareTransform.indexOf('NaN') === -1, `Glare transform must not contain NaN (got: ${glareTransform})`);
        assert.ok(glareTransform.indexOf('Infinity') === -1, `Glare transform must not contain Infinity (got: ${glareTransform})`);

        const moonTransform = sb.document.getElementById('moon').style.transform;
        assert.ok(moonTransform.indexOf('NaN') === -1, `Moon transform must not contain NaN (got: ${moonTransform})`);
      }
    });

    sb.dispose();
  });

  test('1.4: [LATENT DEFECT 1] Midnight-boundary crossing & pre-dawn palette cross-fade (04:10 - 05:00 AM)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();

    // At 4:45 AM (15 minutes before 5:00 AM dawn), BLEND_MINUTES is 50.
    // The palette should be actively blending from night into dawn (t = 1 - 15/50 = 0.70).
    // Night top: #03051a, Dawn top: #1b1d3f.
    // In current implementation: boundary=29, minutesLeft=(29 - 4.75)*60 = 1455 min, causing t=0.
    sb.Scenery.update(new Date('2026-10-29T04:45:00'));
    const preDawnTop = sb.document.documentElement.style.getPropertyValue('--sky-top');

    sb.Scenery.update(new Date('2026-10-29T03:00:00'));
    const deepNightTop = sb.document.documentElement.style.getPropertyValue('--sky-top');

    // The pre-dawn color at 4:45 AM MUST be blended towards dawn and distinct from deep night!
    assert.notStrictEqual(
      preDawnTop,
      deepNightTop,
      `Pre-dawn palette at 04:45 AM MUST blend towards dawn! Got deep night color '${preDawnTop}' due to midnight wrap bug in paletteAt()!`
    );

    sb.dispose();
  });

  test('1.5: 24-Hour continuous palette sweep verifies all color hex codes and ratios remain strictly bounded', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();

    const hexRegex = /^#[0-9a-f]{6}$/i;

    // Sample every 10 minutes over a full 24-hour cycle (144 time points)
    for (let m = 0; m < 1440; m += 10) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      const d = new Date(`2026-10-29T${h < 10 ? '0' + h : h}:${min < 10 ? '0' + min : min}:00`);
      sb.Scenery.update(d);

      const style = sb.document.documentElement.style;
      const top = style.getPropertyValue('--sky-top');
      const mid = style.getPropertyValue('--sky-mid');
      const low = style.getPropertyValue('--sky-low');
      const floor = style.getPropertyValue('--floor');
      const glare = style.getPropertyValue('--glare');
      const rays = parseFloat(style.getPropertyValue('--rays'));
      const stars = parseFloat(style.getPropertyValue('--stars'));
      const aurora = parseFloat(style.getPropertyValue('--aurora'));

      assert.ok(hexRegex.test(top), `Invalid top hex '${top}' at ${h}:${min}`);
      assert.ok(hexRegex.test(mid), `Invalid mid hex '${mid}' at ${h}:${min}`);
      assert.ok(hexRegex.test(low), `Invalid low hex '${low}' at ${h}:${min}`);
      assert.ok(hexRegex.test(floor), `Invalid floor hex '${floor}' at ${h}:${min}`);
      assert.ok(hexRegex.test(glare), `Invalid glare hex '${glare}' at ${h}:${min}`);

      assert.ok(!isNaN(rays) && rays >= 0 && rays <= 1, `Rays out of bounds: ${rays} at ${h}:${min}`);
      assert.ok(!isNaN(stars) && stars >= 0 && stars <= 1, `Stars out of bounds: ${stars} at ${h}:${min}`);
      assert.ok(!isNaN(aurora) && aurora >= 0 && aurora <= 1, `Aurora out of bounds: ${aurora} at ${h}:${min}`);
    }

    sb.dispose();
  });

  // ==========================================================================
  // Section 2: Weather Classification & Lexicon Hardening
  // ==========================================================================
  console.log('\n--- Section 2: Weather Classification & Lexicon Hardening ---');

  test('2.1: classifyWeather wttr.in & Open-Meteo comprehensive 35-term condition taxonomy', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);

    const taxonomy = [
      { desc: 'Clear', expected: 'clear' },
      { desc: 'Sunny', expected: 'clear' },
      { desc: 'Fair', expected: 'clear' },
      { desc: 'Partly cloudy', expected: 'cloudy' },
      { desc: 'Cloudy', expected: 'cloudy' },
      { desc: 'Overcast', expected: 'cloudy' },
      { desc: 'Mist', expected: 'fog' },
      { desc: 'Fog', expected: 'fog' },
      { desc: 'Freezing fog', expected: 'fog' },
      { desc: 'Haze', expected: 'fog' },
      { desc: 'Patchy rain possible', expected: 'rain' },
      { desc: 'Patchy light drizzle', expected: 'rain' },
      { desc: 'Light drizzle', expected: 'rain' },
      { desc: 'Freezing drizzle', expected: 'rain' },
      { desc: 'Light rain', expected: 'rain' },
      { desc: 'Moderate rain at times', expected: 'rain' },
      { desc: 'Moderate rain', expected: 'rain' },
      { desc: 'Heavy rain', expected: 'rain' },
      { desc: 'Torrential rain shower', expected: 'rain' },
      { desc: 'Patchy snow possible', expected: 'snow' },
      { desc: 'Patchy sleet possible', expected: 'snow' },
      { desc: 'Blowing snow', expected: 'snow' },
      { desc: 'Blizzard', expected: 'snow' },
      { desc: 'Light snow', expected: 'snow' },
      { desc: 'Moderate snow', expected: 'snow' },
      { desc: 'Heavy snow', expected: 'snow' },
      { desc: 'Ice pellets', expected: 'snow' },
      { desc: 'Thundery outbreaks possible', expected: 'thunder' },
      { desc: 'Patchy light rain with thunder', expected: 'thunder' },
      { desc: 'Moderate or heavy rain with thunder', expected: 'thunder' },
      { desc: 'Patchy light snow with thunder', expected: 'thunder' },
      { desc: 'Moderate or heavy snow with thunder', expected: 'thunder' },
      { desc: 'Severe storm warning', expected: 'thunder' },
      { desc: 'Violent thunderstorm', expected: 'thunder' },
      { desc: 'Frequent lightning observed', expected: 'thunder' }
    ];

    taxonomy.forEach(({ desc, expected }) => {
      const mode = sb.Scenery.classifyWeather(desc);
      assert.strictEqual(mode, expected, `Description '${desc}' classified as '${mode}', expected '${expected}'`);
    });

    sb.dispose();
  });

  test('2.2: classifyWeather adversarial non-ASCII, Cyrillic, Chinese, pure emoji, symbols, and objects', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);

    const adversarialInputs = [
      { input: '🌧️', expected: 'clear' },
      { input: '🌧️ Heavy Rain', expected: 'rain' },
      { input: '🌩️ Severe Storm', expected: 'thunder' },
      { input: '🌨️ Heavy Blizzard', expected: 'snow' },
      { input: 'München Starker Regen', expected: 'clear' },
      { input: 'Москва Снег', expected: 'clear' },
      { input: '北京 大雨', expected: 'clear' },
      { input: 'Tokyo 雨', expected: 'clear' },
      { input: '', expected: 'clear' },
      { input: null, expected: 'clear' },
      { input: undefined, expected: 'clear' },
      { input: 404, expected: 'clear' },
      { input: { condition: 'rain' }, expected: 'clear' },
      { input: ['rain'], expected: 'rain' },
      { input: '   ', expected: 'clear' }
    ];

    adversarialInputs.forEach(({ input, expected }, idx) => {
      const res = sb.Scenery.classifyWeather(input);
      assert.strictEqual(res, expected, `Adversarial input #${idx} (${String(input)}) expected '${expected}', got '${res}'`);
    });

    sb.dispose();
  });

  test('2.3: Boundary numeric temperature formatting (-50°C to +60°C, 0°C, decimals)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();
    sb.Scenery.update(new Date('2026-10-29T12:00:00'));

    const tempTests = [
      { tempC: -50, expectedTemp: '-50°C' },
      { tempC: -40.5, expectedTemp: '-40.5°C' },
      { tempC: 0, expectedTemp: '0°C' },
      { tempC: 0.0, expectedTemp: '0°C' },
      { tempC: 37.5, expectedTemp: '37.5°C' },
      { tempC: 60, expectedTemp: '60°C' }
    ];

    tempTests.forEach(({ tempC, expectedTemp }) => {
      sb.Scenery.setWeather({ tempC, desc: 'Sunny', sunrise: '6:00 AM', sunset: '6:00 PM' });
      const tempEl = sb.document.getElementById('weatherTemp');
      assert.strictEqual(tempEl.textContent, expectedTemp, `Temperature ${tempC} should format as ${expectedTemp}`);

      const detailEl = sb.document.getElementById('detail');
      assert.ok(detailEl.textContent.indexOf(expectedTemp) !== -1, `Detail text '${detailEl.textContent}' must contain '${expectedTemp}'`);
    });

    // Test resilience against corrupt temperatures
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ tempC: NaN, desc: 'Overcast' });
      sb.Scenery.setWeather({ tempC: null, desc: 'Rain' });
      sb.Scenery.setWeather({ tempC: undefined, desc: 'Snow' });
    });

    sb.dispose();
  });

  test('2.4: [LATENT DEFECT 4] String temperature input (tempC: "24") causes UI desync between #weatherTemp and #detail', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();
    sb.Scenery.update(new Date('2026-10-29T12:00:00'));

    // wttr.in or API JSON may supply tempC as string: { tempC: '24', desc: 'Rain' }
    sb.Scenery.setWeather({ tempC: '24', desc: 'Rain', sunrise: '6:00 AM', sunset: '6:00 PM' });

    const badgeText = sb.document.getElementById('weatherTemp').textContent;
    const detailText = sb.document.getElementById('detail').textContent;

    // updateWeatherBadge formats '24' -> '24°C'
    assert.strictEqual(badgeText, '24°C', 'Weather badge must format string temperature');

    // writeDetail in scenery.js line 481 checks `if (liveWeather && typeof liveWeather.tempC === 'number')`
    // which skips weather for string '24' and falls back to moon phase!
    assert.ok(
      detailText.indexOf('24°C') !== -1,
      `Detail text MUST include '24°C', but got '${detailText}'! Defect: writeDetail strictly checks typeof === 'number' causing moon fallback desync!`
    );

    sb.dispose();
  });

  test('2.5: Weather badge micro-icon SVG vector integrity across all 6 modes', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);

    const modes = ['clear', 'cloudy', 'rain', 'thunder', 'fog', 'snow'];
    modes.forEach(mode => {
      const svg = sb.Scenery.getWeatherMicroIconSvg(mode);
      assert.ok(svg.startsWith('<svg viewBox="0 0 28 28"'), `SVG for '${mode}' must have viewBox '0 0 28 28'`);
      assert.ok(svg.endsWith('</svg>'), `SVG for '${mode}' must close properly`);

      if (mode === 'clear') assert.ok(svg.indexOf('weather-icon--sun') !== -1, 'Clear icon must have .weather-icon--sun');
      if (mode === 'cloudy') assert.ok(svg.indexOf('weather-icon--cloud') !== -1, 'Cloudy icon must have .weather-icon--cloud');
      if (mode === 'rain') assert.ok(svg.indexOf('weather-icon--drop') !== -1, 'Rain icon must have .weather-icon--drop');
      if (mode === 'thunder') assert.ok(svg.indexOf('weather-icon--flash') !== -1, 'Thunder icon must have .weather-icon--flash');
      if (mode === 'snow') assert.ok(svg.indexOf('weather-icon--snow') !== -1, 'Snow icon must have .weather-icon--snow');
      if (mode === 'fog') assert.ok(svg.indexOf('weather-icon--cloud') !== -1, 'Fog icon must use cloud lines');
    });

    sb.dispose();
  });

  // ==========================================================================
  // Section 3: Scenery DOM & State Invariance
  // ==========================================================================
  console.log('\n--- Section 3: Scenery DOM & State Invariance ---');

  test('3.1: [LATENT DEFECT 2] Scenery.init() non-idempotence and DOM child node accumulation leak', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);

    // Initial setup
    sb.Scenery.init();
    const twinkles1 = sb.document.getElementById('twinkles').children.length;
    const flares1 = sb.document.getElementById('flares').children.length;
    const fireflies1 = sb.document.getElementById('fireflies').children.length;

    // Second init call
    sb.Scenery.init();
    const twinkles2 = sb.document.getElementById('twinkles').children.length;
    const flares2 = sb.document.getElementById('flares').children.length;
    const fireflies2 = sb.document.getElementById('fireflies').children.length;

    assert.strictEqual(
      twinkles2,
      twinkles1,
      `Scenery.init() MUST be idempotent! #twinkles leaked child elements on second init (initial: ${twinkles1}, after 2nd: ${twinkles2})`
    );
    assert.strictEqual(
      flares2,
      flares1,
      `Scenery.init() MUST be idempotent! #flares leaked child elements on second init (initial: ${flares1}, after 2nd: ${flares2})`
    );
    assert.strictEqual(
      fireflies2,
      fireflies1,
      `Scenery.init() MUST be idempotent! #fireflies leaked child elements on second init (initial: ${fireflies1}, after 2nd: ${fireflies2})`
    );

    sb.dispose();
  });

  test('3.2: 150 consecutive rapid setWeatherMode() calls without class desynchronization', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();
    const screen = sb.document.getElementById('screen');

    const sequence = ['clear', 'rain', 'thunder', 'fog', 'snow', 'cloudy', 'mist'];

    for (let i = 0; i < 150; i++) {
      const target = sequence[i % sequence.length];
      sb.Scenery.setWeatherMode(target);

      const activeMode = sb.Scenery.getWeatherMode();
      // 'mist' is intentionally normalized to 'fog'
      const expectedMode = target === 'mist' ? 'fog' : target;
      assert.strictEqual(activeMode, expectedMode);

      assert.strictEqual(screen.classList.contains('weather-' + expectedMode), true);

      if (expectedMode === 'fog' || expectedMode === 'mist') {
        assert.strictEqual(screen.classList.contains('weather-fog'), true);
        assert.strictEqual(screen.classList.contains('weather-mist'), true);
      }
    }

    sb.dispose();
  });

  test('3.3: Weather mode updates while paused preserve .weather-paused class on #screen', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();
    const screen = sb.document.getElementById('screen');

    sb.Scenery.pause();
    assert.strictEqual(screen.classList.contains('weather-paused'), true);

    sb.Scenery.setWeatherMode('snow');
    assert.strictEqual(screen.classList.contains('weather-paused'), true, 'setWeatherMode while paused must not drop .weather-paused');
    assert.strictEqual(screen.classList.contains('weather-snow'), true);

    sb.Scenery.setWeather({ tempC: 10, desc: 'Heavy thunderstorm' });
    assert.strictEqual(screen.classList.contains('weather-paused'), true, 'setWeather while paused must not drop .weather-paused');
    assert.strictEqual(screen.classList.contains('weather-snow'), true);

    sb.Scenery.setWeatherMode(null);
    assert.strictEqual(screen.classList.contains('weather-paused'), true);
    assert.strictEqual(screen.classList.contains('weather-thunder'), true);

    sb.Scenery.resume();
    assert.strictEqual(screen.classList.contains('weather-paused'), false);

    sb.dispose();
  });

  test('3.4: Visitor scheduling lifecycle: Day (sendBirds) vs Night (sendMeteor) timer arming and pause clearing', () => {
    const sb = createSandbox(htmlContent);
    const scheduledFns = [];
    const clearedIds = [];

    const origSet = sb.setTimeout;
    const origClear = sb.clearTimeout;

    sb.setTimeout = (fn, ms) => {
      const id = origSet(fn, ms);
      scheduledFns.push({ id, name: fn.name || 'anon' });
      return id;
    };
    sb.clearTimeout = (id) => {
      clearedIds.push(id);
      return origClear(id);
    };

    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init();

    // Day update at 14:00
    sb.Scenery.update(new Date('2026-10-29T14:00:00'));
    assert.ok(scheduledFns.some(s => s.name === 'sendBirds'), 'Day update must schedule sendBirds');

    const birdsScheduled = scheduledFns.find(s => s.name === 'sendBirds');
    sb.Scenery.pause();
    assert.ok(clearedIds.includes(birdsScheduled.id), 'pause() must clear sendBirds timer');

    // Night update at 22:00
    sb.Scenery.resume();
    sb.Scenery.update(new Date('2026-10-29T22:00:00'));
    assert.ok(scheduledFns.some(s => s.name === 'sendMeteor'), 'Night update must schedule sendMeteor');

    const meteorScheduled = scheduledFns.filter(s => s.name === 'sendMeteor').pop();
    sb.Scenery.pause();
    assert.ok(clearedIds.includes(meteorScheduled.id), 'pause() must clear sendMeteor timer');

    sb.dispose();
  });

  test('3.5: [LATENT DEFECT 3] Visitor callbacks sendBirds & sendMeteor must check isPaused before re-arming timers', () => {
    const sendBirdsMatch = /function sendBirds\(\)\s*\{([\s\S]*?)\n  \}/.exec(sceneryJsContent);
    assert.ok(sendBirdsMatch, 'function sendBirds() must exist');
    const sendBirdsBody = sendBirdsMatch[1];

    const sendMeteorMatch = /function sendMeteor\(\)\s*\{([\s\S]*?)\n  \}/.exec(sceneryJsContent);
    assert.ok(sendMeteorMatch, 'function sendMeteor() must exist');
    const sendMeteorBody = sendMeteorMatch[1];

    const birdsHasPausedCheck = sendBirdsBody.includes('isPaused');
    assert.strictEqual(
      birdsHasPausedCheck,
      true,
      'sendBirds() MUST check !isPaused before re-scheduling birdTimer! Currently it re-arms unconditionally even if scenery is paused.'
    );

    const meteorHasPausedCheck = sendMeteorBody.includes('isPaused');
    assert.strictEqual(
      meteorHasPausedCheck,
      true,
      'sendMeteor() MUST check !isPaused before re-scheduling meteorTimer! Currently it re-arms unconditionally even if scenery is paused.'
    );
  });

  // ==========================================================================
  // Section 4: CSS Layers, GPU Compositing & Performance Guardrails
  // ==========================================================================
  console.log('\n--- Section 4: CSS Layers & GPU Compositing Guardrails ---');

  test('4.1: CSS GPU Compositing Invariant: 100% of @keyframes rules animate strictly transform and/or opacity', () => {
    const kfRegex = /@keyframes\s+([a-zA-Z0-9_-]+)\s*\{([\s\S]*?\}\s*)\}/g;
    let km;
    const nonGpuProps = [];

    while ((km = kfRegex.exec(appCssContent)) !== null) {
      const name = km[1];
      const body = km[2];
      const declRegex = /([a-z-]+)\s*:/gi;
      let dm;
      while ((dm = declRegex.exec(body)) !== null) {
        const p = dm[1].toLowerCase();
        if (p !== 'transform' && p !== 'opacity' && p !== 'offset') {
          nonGpuProps.push({ keyframe: name, property: p });
        }
      }
    }

    assert.strictEqual(
      nonGpuProps.length,
      0,
      `Non-GPU composited properties found in @keyframes: ${JSON.stringify(nonGpuProps)}`
    );
  });

  test('4.2: CSS Zero-Blur Shader & Zero-Reflow Invariant across entire app.css', () => {
    const rules = new CSSRuleBook(appCssContent);

    const hasBlur = rules.hasForbiddenProperty('filter', /blur\s*\(/i) ||
                    rules.hasForbiddenProperty('backdrop-filter', /blur\s*\(/i);
    assert.strictEqual(hasBlur, false, 'No CSS filter: blur() or backdrop-filter: blur() permitted!');

    const forbiddenProps = ['width', 'height', 'top', 'left', 'bottom', 'right', 'margin', 'padding'];
    for (const [name, body] of rules.keyframes.entries()) {
      for (const prop of forbiddenProps) {
        const re = new RegExp(`\\b${prop}\\s*:`, 'i');
        assert.strictEqual(
          re.test(body),
          false,
          `Keyframe '${name}' must not animate reflow property '${prop}'`
        );
      }
    }
  });

  test('4.3: Projector TV Performance Mode overrides: desktop layers display:none !important', () => {
    const rules = new CSSRuleBook(appCssContent);

    const desktopLayers = [
      '.grain',
      '.flares',
      '.godrays',
      '.glare-ring',
      '.glare-streak',
      '.glow',
      '.glitter',
      '.birds',
      '.meteor'
    ];

    desktopLayers.forEach(sel => {
      const val = rules.getProperty(sel, 'display');
      assert.ok(
        val && val.indexOf('none') !== -1,
        `Desktop layer '${sel}' must have display: none !important in Projector Performance Mode (got: ${val})`
      );
    });
  });

  test('4.4: Weather Pause Lifecycle State halts all animations via .screen.weather-paused *', () => {
    const rules = new CSSRuleBook(appCssContent);

    const pauseSel = '.screen.weather-paused *';
    const val = rules.getProperty(pauseSel, 'animation-play-state');
    assert.ok(
      val && val.indexOf('paused') !== -1,
      `.screen.weather-paused * must enforce animation-play-state: paused !important (got: ${val})`
    );
  });

  // ==========================================================================
  // Section 5: Real Headless Chromium / Edge Browser Verification
  // ==========================================================================
  console.log('\n--- Section 5: Real Headless Browser CDP Verification ---');

  await test('5.1: Headless Edge CDP Scenery verification: live rendering, weather modes, and GPU styles', async () => {
    const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    if (!fs.existsSync(EDGE_PATH)) {
      console.log('    [SKIP] Microsoft Edge not found at standard path, skipping CDP test');
      return;
    }

    const PORT = 8196;
    const CDP_PORT = 9230;

    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/skylight/index.html';
      const fullPath = path.join(PROJECT_ROOT, reqPath.replace(/^\//, ''));
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
        res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
        fs.createReadStream(fullPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise(r => server.listen(PORT, '127.0.0.1', r));

    const edge = spawn(EDGE_PATH, [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `http://127.0.0.1:${PORT}/skylight/index.html?weather=rain`
    ], { stdio: 'ignore' });

    try {
      let wsUrl = null;
      for (let i = 0; i < 25; i++) {
        try {
          const resp = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
          if (resp.ok) {
            const targets = await resp.json();
            const page = targets.find(t => t.type === 'page');
            if (page && page.webSocketDebuggerUrl) {
              wsUrl = page.webSocketDebuggerUrl;
              break;
            }
          }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 200));
      }

      if (!wsUrl) throw new Error('CDP connection timeout');

      const ws = new WebSocket(wsUrl);
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });

      let reqId = 1;
      function call(method, params = {}) {
        return new Promise((resolve, reject) => {
          const id = reqId++;
          const handler = (evt) => {
            const msg = JSON.parse(evt.data);
            if (msg.id === id) {
              ws.removeEventListener('message', handler);
              if (msg.error) reject(new Error(msg.error.message));
              else resolve(msg.result);
            }
          };
          ws.addEventListener('message', handler);
          ws.send(JSON.stringify({ id, method, params }));
        });
      }

      await call('Runtime.enable');

      const r1 = await call('Runtime.evaluate', {
        expression: `document.getElementById('screen').className`,
        returnByValue: true
      });
      assert.ok(r1.result.value.indexOf('weather-rain') !== -1, `Live browser must have weather-rain class (got: ${r1.result.value})`);

      await call('Runtime.evaluate', {
        expression: `window.Scenery.setWeatherMode('thunder')`
      });
      const r2 = await call('Runtime.evaluate', {
        expression: `document.getElementById('screen').className`,
        returnByValue: true
      });
      assert.ok(r2.result.value.indexOf('weather-thunder') !== -1, `Live browser must have weather-thunder after switch`);

      await call('Runtime.evaluate', { expression: `window.Scenery.pause()` });
      const r3 = await call('Runtime.evaluate', {
        expression: `document.getElementById('screen').classList.contains('weather-paused')`,
        returnByValue: true
      });
      assert.strictEqual(r3.result.value, true, `Screen must have weather-paused class after pause()`);

      ws.close();
    } finally {
      edge.kill();
      server.close();
    }
  });

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n=================================================================');
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  if (failedTests > 0) {
    console.log('\nLATENT DEFECTS EXPOSED BY ADVERSARIAL STRESS TESTING:');
    failures.forEach((f, idx) => {
      console.log(`  [DEFECT ${idx + 1}] ${f.name}`);
      console.log(`    Detail: ${f.error.message}\n`);
    });
  }
  console.log('=================================================================\n');

  process.exit(failedTests > 0 ? 1 : 0);
}

runAll().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
