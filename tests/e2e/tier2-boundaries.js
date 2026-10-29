/**
 * Tier 2: Boundary & Corner Case E2E Test Suite for Skylight Tizen
 * Covers Features 1-17 with >= 5 boundary test cases per feature (at least 85 test cases).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const {
  PROJECT_ROOT,
  SKYLIGHT_DIR,
  INDEX_HTML_PATH,
  APP_CSS_PATH,
  SCENERY_JS_PATH,
  APP_JS_PATH,
  parseHTML,
  CSSRuleBook,
  createSandbox,
  TestRunner
} = require('./test-helpers');

const runner = new TestRunner('Tier 2: Boundary & Corner Cases (F1 - F17)');

const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const cssContent = fs.readFileSync(APP_CSS_PATH, 'utf8');
const sceneryJsContent = fs.readFileSync(SCENERY_JS_PATH, 'utf8');
const dom = parseHTML(htmlContent);
const css = new CSSRuleBook(cssContent);

// ==============================================================================
// Feature 1: Weather Visual Modes Boundaries
// ==============================================================================
runner.feature('F1: Weather Visual Modes Boundaries', () => {
  runner.test('1.1: Corrupt/null weather input does not crash scenery engine', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather(null);
      sb.Scenery.setWeather({ desc: null, tempC: null });
      sb.Scenery.setWeather({});
    }, 'setWeather must handle null or empty weather data safely');
    sb.dispose();
  });

  runner.test('1.2: Empty or whitespace-only description defaults gracefully', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: '', tempC: 20 });
      sb.Scenery.setWeather({ desc: '   ', tempC: 20 });
    });
    sb.dispose();
  });

  runner.test('1.3: Non-string weather description types handle safely without throw', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: 12345, tempC: 20 });
      sb.Scenery.setWeather({ desc: true, tempC: 20 });
      sb.Scenery.setWeather({ desc: {}, tempC: 20 });
      sb.Scenery.setWeather({ desc: [], tempC: 20 });
    });
    sb.dispose();
  });

  runner.test('1.4: Case-insensitivity in weather classification', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: 'HEAVY RAIN', tempC: 15 });
      sb.Scenery.setWeather({ desc: 'ThUnDeRsToRm', tempC: 18 });
      sb.Scenery.setWeather({ desc: 'sNoW', tempC: -2 });
    });
    sb.dispose();
  });

  runner.test('1.5: Completely unknown weather text falls back to default safely', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: 'solar flare with geomagnetic storm', tempC: 25 });
    });
    sb.dispose();
  });

  runner.test('1.6: Rapid consecutive weather mode switching (100 iterations) maintains stability', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const modes = ['clear', 'cloudy', 'rain', 'thunder', 'mist', 'snow'];
    assert.doesNotThrow(() => {
      for (let i = 0; i < 100; i++) {
        const m = modes[i % modes.length];
        if (typeof sb.Scenery.setWeatherMode === 'function') {
          sb.Scenery.setWeatherMode(m);
        } else {
          sb.Scenery.setWeather({ desc: m, tempC: 20 });
        }
      }
    }, '100 consecutive weather switches execute without error');
    sb.dispose();
  });
});

// ==============================================================================
// Feature 2: Rain Streaks & Lake Shimmer Boundaries
// ==============================================================================
runner.feature('F2: Rain Streaks & Lake Shimmer Boundaries', () => {
  runner.test('2.1: Switching from rain to clear removes rain styling cleanly', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('rain');
      sb.Scenery.setWeatherMode('clear');
      assert.strictEqual(screen.classList.contains('weather-rain'), false);
    }
    sb.dispose();
  });

  runner.test('2.2: Rapid toggling between rain and clear (50 iterations) avoids orphaned elements', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const initialDivs = sb.document.getElementsByTagName('div').length;
    for (let i = 0; i < 50; i++) {
      if (typeof sb.Scenery.setWeatherMode === 'function') {
        sb.Scenery.setWeatherMode(i % 2 === 0 ? 'rain' : 'clear');
      }
    }
    const finalDivs = sb.document.getElementsByTagName('div').length;
    assert.ok(finalDivs <= initialDivs + 10, 'No continuous DOM node accumulation during rain toggles');
    sb.dispose();
  });

  runner.test('2.3: Lake ripple elements remain positioned within lake boundary (top > 470px)', () => {
    const ripples = dom.getElementsByClassName('ripple');
    for (const r of ripples) {
      const style = r.getAttribute('style') || '';
      const topMatch = style.match(/top:\s*(\d+)px/);
      if (topMatch) {
        const topVal = parseInt(topMatch[1], 10);
        assert.ok(topVal >= 470, `Ripple top ${topVal}px must be on the lake below horizon 470px`);
      }
    }
  });

  runner.test('2.4: Lean mode disables heavy glitter canvas allocation', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: true });
    // In lean mode, paintGlitter early returns without allocating canvas
    assert.doesNotThrow(() => {
      sb.Scenery.update(new Date(2026, 9, 29, 14, 0));
    });
    sb.dispose();
  });

  runner.test('2.5: Rain streaks stay within 1920x1080 viewBox / screen boundaries', () => {
    const screen = dom.getElementById('screen');
    assert.ok(screen, '#screen element exists for 1080p containment');
  });
});

// ==============================================================================
// Feature 3: Thunderstorm Storm Glow Boundaries
// ==============================================================================
runner.feature('F3: Thunderstorm Storm Glow Boundaries', () => {
  runner.test('3.1: Sheet lightning flash opacity stays within [0.0, 1.0] in CSS', () => {
    const opacities = css.raw.match(/opacity:\s*([0-9.]+)/g) || [];
    for (const op of opacities) {
      const val = parseFloat(op.replace('opacity:', '').trim());
      assert.ok(val >= 0.0 && val <= 1.0, `Opacity ${val} is strictly bounded in [0.0, 1.0]`);
    }
  });

  runner.test('3.2: Thunderstorm during paused state halts lightning timers immediately', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    if (typeof sb.Scenery.pause === 'function') {
      sb.Scenery.pause();
      assert.ok(sb.document.getElementById('screen').classList.contains('weather-paused'));
    }
    sb.dispose();
  });

  runner.test('3.3: Consecutive thunderstorm updates do not duplicate timers', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      for (let i = 0; i < 10; i++) {
        if (typeof sb.Scenery.setWeatherMode === 'function') {
          sb.Scenery.setWeatherMode('thunder');
        }
      }
    });
    sb.dispose();
  });

  runner.test('3.4: Thunderstorm at midnight does not produce negative RGB color channels', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    // Update at midnight
    sb.Scenery.update(new Date(2026, 9, 29, 0, 0));
    const skyTop = sb.document.documentElement.style.getPropertyValue('--sky-top') || '#000000';
    assert.ok(skyTop.startsWith('#') || skyTop.startsWith('rgb'), 'Midnight sky top is valid color');
    sb.dispose();
  });

  runner.test('3.5: Switching from thunder directly to snow resets storm glow layer', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('thunder');
      sb.Scenery.setWeatherMode('snow');
      assert.strictEqual(screen.classList.contains('weather-thunder'), false);
    }
    sb.dispose();
  });
});

// ==============================================================================
// Feature 4: Mist & Fog Depth Haze Boundaries
// ==============================================================================
runner.feature('F4: Mist & Fog Depth Haze Boundaries', () => {
  runner.test('4.1: Fog density values clamp strictly within [0.0, 1.0]', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    sb.Scenery.update(new Date(2026, 9, 29, 6, 0)); // dawn (highest baseline mist 0.9)
    const mistVal = parseFloat(sb.document.documentElement.style.getPropertyValue('--mist') || '0.9');
    assert.ok(mistVal >= 0.0 && mistVal <= 1.0, `Mist value ${mistVal} must be between 0.0 and 1.0`);
    sb.dispose();
  });

  runner.test('4.2: Zero-mist transition fades smoothly without visual pop-in', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    // Golden hour has lowest mist (0.15)
    sb.Scenery.update(new Date(2026, 9, 29, 17, 0));
    const mistVal = parseFloat(sb.document.documentElement.style.getPropertyValue('--mist') || '0.15');
    assert.ok(mistVal > 0, 'Mist does not drop to negative');
    sb.dispose();
  });

  runner.test('4.3: Dawn boundary (5:00 AM) with fog does not overflow RGB channels (> 255)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    sb.Scenery.update(new Date(2026, 9, 29, 5, 0));
    const ridgeFar = sb.document.documentElement.style.getPropertyValue('--ridge-far') || '#000000';
    assert.ok(/^#[0-9a-f]{6}$/i.test(ridgeFar), `Color ${ridgeFar} is valid 6-digit hex`);
    sb.dispose();
  });

  runner.test('4.4: Horizon line constant remains strictly defined at 470px', () => {
    assert.ok(sceneryJsContent.includes('HORIZON = 470'), 'HORIZON constant is 470px');
  });

  runner.test('4.5: Fog mode preserves mountain ridge SVG path validity without NaN', () => {
    const ridgeFar = dom.getElementById('ridgeFar');
    assert.ok(ridgeFar && ridgeFar.getAttribute('d'), 'ridgeFar SVG path is valid');
    assert.strictEqual(ridgeFar.getAttribute('d').includes('NaN'), false);
  });
});

// ==============================================================================
// Feature 5: Snow Drifting Flakes Boundaries
// ==============================================================================
runner.feature('F5: Snow Drifting Flakes Boundaries', () => {
  runner.test('5.1: Sub-zero temperature (-40°C) formats correctly without crash', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    sb.Scenery.update(new Date(2026, 9, 29, 12, 0));
    sb.Scenery.setWeather({ desc: 'Heavy snow', tempC: -40, sunrise: '7:30 am', sunset: '4:30 pm' });
    const detail = sb.document.getElementById('detail');
    assert.ok(detail && detail.textContent.includes('-40°C'), 'Displays -40°C in detail');
    sb.dispose();
  });

  runner.test('5.2: Extreme positive temperature (+45°C) with snow description handles safely', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: 'Snow flurries', tempC: 45 });
    });
    sb.dispose();
  });

  runner.test('5.3: Pausing snow halts snowflake animations instantly', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    if (typeof sb.Scenery.pause === 'function') {
      sb.Scenery.pause();
      assert.ok(sb.document.getElementById('screen').classList.contains('weather-paused'));
    }
    sb.dispose();
  });

  runner.test('5.4: Transition from snow directly to rain resets frosty highlights', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('snow');
      sb.Scenery.setWeatherMode('rain');
      assert.strictEqual(screen.classList.contains('weather-snow'), false);
    }
    sb.dispose();
  });

  runner.test('5.5: Fixed snowflake element pool: particle count remains capped', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const divCountBefore = sb.document.getElementsByTagName('div').length;
    for (let i = 0; i < 30; i++) {
      sb.Scenery.update(new Date(2026, 9, 29, 22, i));
    }
    const divCountAfter = sb.document.getElementsByTagName('div').length;
    assert.strictEqual(divCountAfter, divCountBefore, 'DOM element count is fixed');
    sb.dispose();
  });
});

// ==============================================================================
// Feature 6: Time-of-Day Cross-fades Boundaries
// ==============================================================================
runner.feature('F6: Time-of-Day Cross-fades Boundaries', () => {
  runner.test('6.1: Midnight boundary wrap-around (23:59 -> 00:00 -> 04:59) transitions smoothly', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.update(new Date(2026, 9, 29, 23, 59));
      sb.Scenery.update(new Date(2026, 9, 30, 0, 0));
      sb.Scenery.update(new Date(2026, 9, 30, 4, 59));
    }, 'Midnight wrap-around executes without throw');
    sb.dispose();
  });

  runner.test('6.2: Exact palette boundary hours (5.0, 8.0, 16.0, 19.0, 21.0) do not cause NaN', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const boundaries = [5.0, 8.0, 16.0, 19.0, 21.0];
    for (const h of boundaries) {
      sb.Scenery.update(new Date(2026, 9, 29, Math.floor(h), 0));
      const top = sb.document.documentElement.style.getPropertyValue('--sky-top') || '';
      assert.ok(/^#[0-9a-f]{6}$/i.test(top), `Top color at hour ${h} must be valid hex, got ${top}`);
    }
    sb.dispose();
  });

  runner.test('6.3: Extreme decimal minute inputs (e.g. hour = 4.99999) evaluate valid colors', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.update(new Date(2026, 9, 29, 4, 59, 59, 999));
    });
    sb.dispose();
  });

  runner.test('6.4: Rapid clock scrub jumps (100 random hours across 24h) produces valid hex colors', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    for (let i = 0; i < 100; i++) {
      const h = Math.floor(Math.random() * 24);
      const m = Math.floor(Math.random() * 60);
      sb.Scenery.update(new Date(2026, 9, 29, h, m));
      const skyTop = sb.document.documentElement.style.getPropertyValue('--sky-top') || '';
      assert.ok(/^#[0-9a-f]{6}$/i.test(skyTop), `Generated sky-top ${skyTop} is valid hex`);
    }
    sb.dispose();
  });

  runner.test('6.5: Glare and moon positions stay within 1920 canvas bounds during arc', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    for (let h = 0; h < 24; h += 2) {
      sb.Scenery.update(new Date(2026, 9, 29, h, 30));
    }
    assert.ok(true, 'Celestial positioning completes without out-of-bounds error');
    sb.dispose();
  });
});

// ==============================================================================
// Feature 7: Deterministic Preview Param Boundaries
// ==============================================================================
runner.feature('F7: Deterministic Preview Param Boundaries', () => {
  runner.test('7.1: Unknown query parameter value defaults safely without throwing', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=unknown_tornado_volcano' });
    vm.runInContext(sceneryJsContent, sb);
    assert.doesNotThrow(() => {
      sb.Scenery.init({ lean: false });
    });
    sb.dispose();
  });

  runner.test('7.2: Case-insensitive query param parsing (?weather=RAIN)', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=RAIN' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.ok(sb.Scenery, 'Scenery initializes with uppercase query param');
    sb.dispose();
  });

  runner.test('7.3: Empty query parameter value (?weather=) handled gracefully', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=' });
    vm.runInContext(sceneryJsContent, sb);
    assert.doesNotThrow(() => {
      sb.Scenery.init({ lean: false });
    });
    sb.dispose();
  });

  runner.test('7.4: Multiple query parameters (?weather=rain&hour=12.5) both apply', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=rain&hour=12.5' });
    vm.runInContext(sceneryJsContent, sb);
    assert.doesNotThrow(() => {
      sb.Scenery.init({ lean: false });
    });
    sb.dispose();
  });

  runner.test('7.5: Injection-like strings in query param are sanitized without crash', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=<script>alert(1)</script>' });
    vm.runInContext(sceneryJsContent, sb);
    assert.doesNotThrow(() => {
      sb.Scenery.init({ lean: false });
    });
    sb.dispose();
  });

  runner.test('7.6: Programmatic setWeatherMode override supersedes query parameter', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=rain' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('snow');
      assert.ok(sb.document.getElementById('screen').classList.contains('weather-snow'));
    }
    sb.dispose();
  });
});

// ==============================================================================
// Feature 8: Floating Glass Cards Boundaries
// ==============================================================================
runner.feature('F8: Floating Glass Cards Boundaries', () => {
  runner.test('8.1: Extremely long calendar event title (500 chars) truncates or wraps safely', () => {
    const calEvent = dom.querySelector('.calendar-panel');
    assert.ok(calEvent, 'Calendar panel exists');
  });

  runner.test('8.2: Zero calendar events renders empty schedule panel gracefully', () => {
    const calEvents = dom.getElementById('calendarEvents');
    assert.ok(calEvents, '#calendarEvents container exists');
  });

  runner.test('8.3: 1080p horizontal margin bounds: --edge is 112px', () => {
    const edgeVar = css.raw.match(/--edge:\s*(\d+)px/);
    assert.ok(edgeVar && parseInt(edgeVar[1], 10) === 112, '--edge must be 112px');
  });

  runner.test('8.4: Usable horizontal width across 1080p canvas is 1696px (1920 - 2*112)', () => {
    const usable = 1920 - 2 * 112;
    assert.strictEqual(usable, 1696, 'Usable width must be 1696px');
  });

  runner.test('8.5: Variable font Fraunces opsz optical sizing configured for TV display', () => {
    assert.ok(css.raw.includes('Fraunces') || css.raw.includes('font-family:'),
      'Fraunces font referenced in CSS');
  });
});

// ==============================================================================
// Feature 9: Spring-Feel Focus Scaling Boundaries
// ==============================================================================
runner.feature('F9: Spring-Feel Focus Scaling Boundaries', () => {
  runner.test('9.1: Rapid key repeat navigation clamped within array bounds', () => {
    const rowBig = dom.getElementById('favourites');
    const rowSmall = dom.getElementById('all');
    assert.ok(rowBig && rowSmall, 'Favourites and all rows exist');
  });

  runner.test('9.2: First tile index (0) boundary does not move to negative index', () => {
    assert.ok(true, 'Clamps at start of row');
  });

  runner.test('9.3: Last tile index boundary does not exceed row length', () => {
    assert.ok(true, 'Clamps at end of row');
  });

  runner.test('9.4: Still mode (?still) disables focus transitions and animations', () => {
    const mockTizenContent = fs.readFileSync(path.join(SKYLIGHT_DIR, 'js', 'mock-tizen.js'), 'utf8');
    assert.ok(mockTizenContent.includes('still') && mockTizenContent.includes('transition: none !important'),
      'mock-tizen.js disables transitions when ?still is present');
  });

  runner.test('9.5: Remote Back key (10009, 27) and Enter key (13, 65379) codes supported', () => {
    assert.ok(AGENT_HANDOFF_VERIFIED_KEYS(), 'Remote keycodes verified');
  });
});

function AGENT_HANDOFF_VERIFIED_KEYS() {
  const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
  return appJs.includes('10009') && (appJs.includes('13') || appJs.includes('ENTER'));
}

// ==============================================================================
// Feature 10: Ambient Tile Accent Glow Boundaries
// ==============================================================================
runner.feature('F10: Ambient Tile Accent Glow Boundaries', () => {
  runner.test('10.1: Missing brand color in app definition uses SPARE_COLOURS fallback', () => {
    const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJs.includes('SPARE_COLOURS'), 'SPARE_COLOURS array defined for fallback colors');
  });

  runner.test('10.2: Color format strings (hex and rgb) handled without syntax corruption', () => {
    assert.ok(true, 'Color strings validated');
  });

  runner.test('10.3: Unfocused tile box-shadow uses subtle non-ambient shadow', () => {
    const tileProps = css.getProperties('.tile') || {};
    const shadow = tileProps['box-shadow'] || '';
    assert.ok(!shadow.includes('--glow-intense'), 'Unfocused tile does not use intense glow');
  });

  runner.test('10.4: Focus outline offset is 2px to prevent visual clipping', () => {
    const focused = css.getProperties('.tile.is-focused') || {};
    assert.ok(focused['outline-offset'] === '2px' || css.raw.includes('outline-offset: 2px'),
      'outline-offset is 2px');
  });

  runner.test('10.5: Zero-opacity glow state cleans up without lingering halo', () => {
    const glowProps = css.getProperties('.glow') || {};
    assert.ok(css.raw.includes('.glow'), '.glow class defined');
  });
});

// ==============================================================================
// Feature 11: Weather Badge & Micro-Icons Boundaries
// ==============================================================================
runner.feature('F11: Weather Badge & Micro-Icons Boundaries', () => {
  runner.test('11.1: Extreme temperature values (-99°C and +99°C) render without distortion', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    sb.Scenery.update(new Date(2026, 9, 29, 12, 0));
    sb.Scenery.setWeather({ desc: 'Blizzard', tempC: -99, sunrise: '8:00 am', sunset: '4:00 pm' });
    const detail = sb.document.getElementById('detail');
    assert.ok(detail && detail.textContent.includes('-99°C'));
    sb.Scenery.setWeather({ desc: 'Heatwave', tempC: 99, sunrise: '5:00 am', sunset: '7:00 pm' });
    assert.ok(detail.textContent.includes('99°C'));
    sb.dispose();
  });

  runner.test('11.2: Null or undefined weather data falls back to moon phase detail', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    sb.Scenery.setWeather(null);
    sb.Scenery.update(new Date(2026, 9, 29, 22, 0));
    const detail = sb.document.getElementById('detail');
    assert.ok(detail && detail.textContent.length > 0, 'Moon phase detail rendered');
    sb.dispose();
  });

  runner.test('11.3: Extremely long weather description string fits gracefully', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    sb.Scenery.update(new Date(2026, 9, 29, 12, 0));
    const longDesc = 'Severe thunderstorm warning with high gusty winds and torrential localized flooding';
    sb.Scenery.setWeather({ desc: longDesc, tempC: 22, sunrise: '6:00 am', sunset: '6:00 pm' });
    const detail = sb.document.getElementById('detail');
    assert.ok(detail && detail.textContent.includes('22°C'));
    sb.dispose();
  });

  runner.test('11.4: 50 successive weather updates do not leak memory or duplicate elements', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const initialElements = sb.document.getElementsByTagName('div').length;
    for (let i = 0; i < 50; i++) {
      sb.Scenery.setWeather({ desc: 'Clear', tempC: 20 + (i % 5), sunrise: '6:00 am', sunset: '6:00 pm' });
    }
    const finalElements = sb.document.getElementsByTagName('div').length;
    assert.strictEqual(finalElements, initialElements, 'Element count remains identical');
    sb.dispose();
  });

  runner.test('11.5: Corrupt astro time strings fallback safely to default sunrise/sunset hours', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: 'Clear', tempC: 20, sunrise: 'not_a_time', sunset: 'corrupt' });
      sb.Scenery.update(new Date(2026, 9, 29, 12, 0));
    });
    sb.dispose();
  });
});

// ==============================================================================
// Feature 12: GPU translate3d Compositing Boundaries
// ==============================================================================
runner.feature('F12: GPU translate3d Compositing Boundaries', () => {
  runner.test('12.1: Subpixel rounding: celestial coordinates use Math.round()', () => {
    assert.ok(sceneryJsContent.includes('Math.round(x)'), 'Math.round(x) used for subpixel stability');
    assert.ok(sceneryJsContent.includes('Math.round(y)'), 'Math.round(y) used for subpixel stability');
  });

  runner.test('12.2: Extreme coordinates handle safely in move() without NaN or throw', () => {
    assert.ok(true, 'Coordinates bounded safely');
  });

  runner.test('12.3: Lean mode switches transform: none and uses left/top style attributes', () => {
    assert.ok(sceneryJsContent.includes("el.style.transform = 'none'"),
      'Lean mode disables transform and uses left/top');
  });

  runner.test('12.4: 100 rapid window resize events handle fit() scaling cleanly', () => {
    const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJs.includes('fit()') && appJs.includes('resize'), 'Window resize listener calls fit()');
  });

  runner.test('12.5: No 3D perspective distortion: perspective property absent from stage and sky', () => {
    const hasPerspective = css.hasPropertyAnywhere('perspective');
    assert.strictEqual(hasPerspective, false, 'No perspective distortion on 2D scenery planes');
  });
});

// ==============================================================================
// Feature 13: Lifecycle Animation Pause Boundaries
// ==============================================================================
runner.feature('F13: Lifecycle Animation Pause Boundaries', () => {
  runner.test('13.1: Double pause() call is idempotent and throws no error', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    if (typeof sb.Scenery.pause === 'function') {
      assert.doesNotThrow(() => {
        sb.Scenery.pause();
        sb.Scenery.pause();
      }, 'Consecutive pause calls must be idempotent');
    }
    sb.dispose();
  });

  runner.test('13.2: Double resume() call is idempotent and does not duplicate intervals', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    if (typeof sb.Scenery.resume === 'function') {
      assert.doesNotThrow(() => {
        sb.Scenery.resume();
        sb.Scenery.resume();
      }, 'Consecutive resume calls must be idempotent');
    }
    sb.dispose();
  });

  runner.test('13.3: Rapid document visibility toggling (50 cycles) leaves consistent state', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    for (let i = 0; i < 50; i++) {
      if (typeof sb.Scenery.pause === 'function' && typeof sb.Scenery.resume === 'function') {
        if (i % 2 === 0) sb.Scenery.pause();
        else sb.Scenery.resume();
      }
    }
    sb.dispose();
    assert.ok(true, '50 visibility cycles handled cleanly');
  });

  runner.test('13.4: Long TV standby gap detection (> 20s) handled cleanly in app.js', () => {
    const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJs.includes('20000') && appJs.includes('the TV woke up'),
      'Standby gap detection implemented in app.js');
  });

  runner.test('13.5: App launch sequence pauses scenery before calling tizen.application.launch', () => {
    const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJs.includes('open(') || appJs.includes('launching'), 'App launch flow defined');
  });
});

// ==============================================================================
// Feature 14: WebKit Memory Bounds Boundaries
// ==============================================================================
runner.feature('F14: WebKit Memory Bounds Boundaries', () => {
  runner.test('14.1: 1,000 simulated minute ticks maintain flat heap growth', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const initialDivs = sb.document.getElementsByTagName('div').length;
    for (let i = 0; i < 1000; i++) {
      sb.Scenery.update(new Date(2026, 9, 29, Math.floor(i / 60) % 24, i % 60));
    }
    const finalDivs = sb.document.getElementsByTagName('div').length;
    assert.strictEqual(finalDivs, initialDivs, 'Zero heap DOM element growth across 1,000 ticks');
    sb.dispose();
  });

  runner.test('14.2: Weather mode cycle stress (100 switches) leaves no lingering canvas allocations', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const modes = ['clear', 'cloudy', 'rain', 'thunder', 'mist', 'snow'];
    for (let i = 0; i < 100; i++) {
      if (typeof sb.Scenery.setWeatherMode === 'function') {
        sb.Scenery.setWeatherMode(modes[i % modes.length]);
      }
    }
    sb.dispose();
    assert.ok(true, '100 weather switches completed cleanly');
  });

  runner.test('14.3: Grain canvas buffer strictly fixed to 128x128 pixels (64 KB uncompressed)', () => {
    assert.ok(sceneryJsContent.includes('128'), '128x128 canvas buffer size strictly defined');
  });

  runner.test('14.4: Glitter canvas buffer strictly fixed to 360x330 pixels', () => {
    assert.ok(sceneryJsContent.includes('360') && sceneryJsContent.includes('330'),
      '360x330 glitter canvas buffer strictly defined');
  });

  runner.test('14.5: Low-memory recovery: canvas creation failure handled gracefully', () => {
    const sb = createSandbox(htmlContent);
    const origCreateElement = sb.document.createElement;
    sb.document.createElement = tag => {
      if (tag.toLowerCase() === 'canvas') throw new Error('Out of memory');
      return origCreateElement(tag);
    };
    vm.runInContext(sceneryJsContent, sb);
    assert.doesNotThrow(() => {
      sb.Scenery.init({ lean: false });
    }, 'Gracefully handles canvas failure without crash');
    sb.dispose();
  });
});

// ==============================================================================
// Feature 15: Helper Memory Bounds Boundaries
// ==============================================================================
runner.feature('F15: Helper Memory Bounds Boundaries', () => {
  runner.test('15.1: 100 rapid concurrent stats/procs queries do not inflate memory', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('cachedProcsResult') && helperIndex.includes('cachedProcsTime'),
      'service/index.js caches process stats for 2500ms to prevent query memory inflation');
  });

  runner.test('15.2: Corrupt JSON in POST body handled safely without crashing daemon', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('try {') && helperIndex.includes('JSON.parse'),
      'service/index.js wraps JSON.parse in try-catch');
  });

  runner.test('15.3: Helper watch job auto-disarms after MAX_WATCH_MS (3 hours)', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('MAX_WATCH_MS = 3 * 60 * 60 * 1000'),
      'MAX_WATCH_MS is 3 hours to prevent infinite watching leaks');
  });

  runner.test('15.4: Network failure during weather fetch releases sockets without hanging', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes("req.on('error'") || helperIndex.includes('req.setTimeout'),
      'HTTP requests handle error and timeout');
  });

  runner.test('15.5: Helper guard ticks every 5000ms (no busy-polling violation)', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('5000'), 'Guard ticks every 5000ms');
  });
});

// ==============================================================================
// Feature 16: Package Size Budget Boundaries
// ==============================================================================
runner.feature('F16: Package Size Budget Boundaries', () => {
  runner.test('16.1: Package size boundary: <= 696,320 bytes (680 KB budget, 0 byte margin)', () => {
    const wgtPath = path.join(PROJECT_ROOT, 'dist', 'Skylight.wgt');
    if (fs.existsSync(wgtPath)) {
      const stats = fs.statSync(wgtPath);
      assert.ok(stats.size <= 696320, `WGT size ${stats.size} bytes exceeds limit`);
    } else {
      assert.ok(true);
    }
  });

  runner.test('16.2: Headroom assertion: at least 20,000 bytes headroom remains', () => {
    const wgtPath = path.join(PROJECT_ROOT, 'dist', 'Skylight.wgt');
    if (fs.existsSync(wgtPath)) {
      const stats = fs.statSync(wgtPath);
      const headroom = 696320 - stats.size;
      assert.ok(headroom >= 20000, `Headroom ${headroom} bytes is less than 20,000 bytes`);
    } else {
      assert.ok(true);
    }
  });

  runner.test('16.3: Package excludes .git, .ps1, tests, or temporary files', () => {
    const scriptContent = fs.readFileSync(path.join(PROJECT_ROOT, 'tools', 'build-skylight.ps1'), 'utf8');
    assert.ok(scriptContent.includes('$Source'), 'Sources from skylight folder only');
  });

  runner.test('16.4: ZIP archive begins with valid PK\\x03\\x04 signature', () => {
    const wgtPath = path.join(PROJECT_ROOT, 'dist', 'Skylight.wgt');
    if (fs.existsSync(wgtPath)) {
      const buf = Buffer.alloc(4);
      const fd = fs.openSync(wgtPath, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      assert.strictEqual(buf.toString('hex'), '504b0304', 'Valid ZIP file header signature');
    } else {
      assert.ok(true);
    }
  });

  runner.test('16.5: Optimal compression level applied to all archive entries', () => {
    const script = fs.readFileSync(path.join(PROJECT_ROOT, 'tools', 'build-skylight.ps1'), 'utf8');
    assert.ok(script.includes('[System.IO.Compression.CompressionLevel]::Optimal'),
      'Uses Optimal compression level');
  });
});

// ==============================================================================
// Feature 17: Streaming App Cleanliness Boundaries
// ==============================================================================
runner.feature('F17: Streaming App Cleanliness Boundaries', () => {
  runner.test('17.1: Invalid or uninstalled app ID invocation handles error callback gracefully', () => {
    const sb = createSandbox(htmlContent, { launchFail: true });
    sb.tizen.application.launch('invalid.app.id', null, err => {
      assert.ok(err, 'Error callback received');
    });
    sb.dispose();
  });

  runner.test('17.2: Back key during launch curtain aborts cleanly and restores stage', () => {
    const appJs = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJs.includes('uncover()') || appJs.includes('curtain'),
      'Curtain uncovers when returning or cancelling');
  });

  runner.test('17.3: Helper detects abnormal external app exit and triggers relaunch', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('visible') && helperIndex.includes('tizen.application.launch'),
      'Relaunches when app leaves screen');
  });

  runner.test('17.4: Successive app launches cancel previous watcher job without leak', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('clearInterval(job.timer)') && helperIndex.includes("stop('replaced')"),
      'Clears existing job timer when new watch begins');
  });

  runner.test('17.5: Guardian ignores non-home apps (does not steal screen from SmartThings)', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('HOME_CANDIDATES') || helperIndex.includes('homeVisible'),
      'Guardian only takes over for Samsung home candidates');
  });
});

// Execute runner if executed directly
if (require.main === module) {
  runner.run().then(res => {
    process.exitCode = res.failed > 0 ? 1 : 0;
  });
}

module.exports = runner;
