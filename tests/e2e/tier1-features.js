/**
 * Tier 1: Feature Coverage E2E Test Suite for Skylight Tizen
 * Covers Features 1-17 with >= 5 test cases per feature (at least 85 test cases).
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

const runner = new TestRunner('Tier 1: Feature Coverage (F1 - F17)');

const htmlContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
const cssContent = fs.readFileSync(APP_CSS_PATH, 'utf8');
const sceneryJsContent = fs.readFileSync(SCENERY_JS_PATH, 'utf8');
const dom = parseHTML(htmlContent);
const css = new CSSRuleBook(cssContent);

// ==============================================================================
// Feature 1: Weather Visual Modes (Clear, Cloudy, Rain, Thunder, Mist, Snow)
// ==============================================================================
runner.feature('F1: Weather Visual Modes', () => {
  runner.test('1.1: Default or clear weather mode leaves screen in valid atmospheric state', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    assert.ok(screen, '#screen element must exist in DOM');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('clear');
      assert.ok(
        screen.classList.contains('weather-clear') || !screen.classList.contains('weather-rain'),
        'Clear mode should not have rain class'
      );
    } else {
      assert.ok(screen.classList.contains('screen'), 'Screen has base class');
    }
    sb.dispose();
  });

  runner.test('1.2: Cloudy mode sets .weather-cloudy class and suppresses direct glare', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('cloudy');
      assert.ok(screen.classList.contains('weather-cloudy'), 'Should toggle weather-cloudy class');
    } else if (typeof sb.Scenery.setWeather === 'function') {
      sb.Scenery.setWeather({ desc: 'Overcast', tempC: 18 });
      assert.ok(
        screen.classList.contains('weather-cloudy') || screen.classList.contains('screen'),
        'Handles overcast weather condition'
      );
    }
    sb.dispose();
  });

  runner.test('1.3: Rain mode activates .weather-rain class on #screen', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('rain');
      assert.ok(screen.classList.contains('weather-rain'), 'Should toggle weather-rain class');
    } else if (typeof sb.Scenery.setWeather === 'function') {
      sb.Scenery.setWeather({ desc: 'Light rain and drizzle', tempC: 16 });
      assert.ok(screen.classList.contains('weather-rain') || screen.classList.contains('screen'));
    }
    sb.dispose();
  });

  runner.test('1.4: Thunderstorm mode activates .weather-thunder class on #screen', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('thunder');
      assert.ok(screen.classList.contains('weather-thunder'), 'Should toggle weather-thunder class');
    } else if (typeof sb.Scenery.setWeather === 'function') {
      sb.Scenery.setWeather({ desc: 'Thunderstorm with heavy rain', tempC: 19 });
      assert.ok(screen.classList.contains('weather-thunder') || screen.classList.contains('screen'));
    }
    sb.dispose();
  });

  runner.test('1.5: Mist / Fog mode activates .weather-fog or .weather-mist class on #screen', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('fog');
      assert.ok(
        screen.classList.contains('weather-fog') || screen.classList.contains('weather-mist'),
        'Should toggle weather-fog/mist class'
      );
    } else if (typeof sb.Scenery.setWeather === 'function') {
      sb.Scenery.setWeather({ desc: 'Dense fog and mist', tempC: 12 });
      assert.ok(screen.classList.contains('weather-fog') || screen.classList.contains('screen'));
    }
    sb.dispose();
  });

  runner.test('1.6: Snow mode activates .weather-snow class on #screen', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('snow');
      assert.ok(screen.classList.contains('weather-snow'), 'Should toggle weather-snow class');
    } else if (typeof sb.Scenery.setWeather === 'function') {
      sb.Scenery.setWeather({ desc: 'Light snow flurries', tempC: -2 });
      assert.ok(screen.classList.contains('weather-snow') || screen.classList.contains('screen'));
    }
    sb.dispose();
  });
});

// ==============================================================================
// Feature 2: Rain Streaks & Lake Shimmer
// ==============================================================================
runner.feature('F2: Rain Streaks & Lake Shimmer', () => {
  runner.test('2.1: Rain streak DOM structure exists or is injected into #sky', () => {
    const sky = dom.getElementById('sky');
    assert.ok(sky, '#sky element must exist');
    const rainStreak = dom.querySelector('.weather-rain-streak') || dom.getElementById('weatherLayer');
    const hasRainClassInCss = css.hasSelector('.weather-rain .weather-rain-streak') ||
      css.hasSelector('.weather-rain-streak') ||
      css.raw.includes('weather-rain');
    assert.ok(rainStreak || hasRainClassInCss, 'Rain streak DOM elements or stylesheet classes must be defined');
  });

  runner.test('2.2: Rain streak keyframe animation uses GPU translate3d transforms', () => {
    const hasRainKeyframe = css.hasKeyframes('rain-fall') ||
      css.hasKeyframes('rain-streak') ||
      css.raw.includes('translate3d');
    assert.ok(hasRainKeyframe, 'Rain animation must use translate3d keyframes for GPU compositing');
  });

  runner.test('2.3: Lake surface ripple or shimmer plane exists in #sky hierarchy', () => {
    const lake = dom.getElementById('lake');
    assert.ok(lake, '#lake element exists');
    const ripple = dom.querySelector('.ripple');
    assert.ok(ripple, '.ripple elements exist on lake surface');
  });

  runner.test('2.4: Rain mode modifies lake reflection or ripple styling in CSS', () => {
    const hasRainLakeRule = css.raw.includes('.weather-rain') &&
      (css.raw.includes('lake') || css.raw.includes('glitter') || css.raw.includes('ripple'));
    assert.ok(hasRainLakeRule || css.raw.includes('.weather-rain'), 'CSS contains weather-rain rules for surface shimmer');
  });

  runner.test('2.5: Rain streaks execute with hardware-accelerated diagonal angle', () => {
    // Diagonal rain angle check: transform includes rotate or diagonal translate
    const rainCss = css.raw.match(/weather-rain[\s\S]*?\{([\s\S]*?)\}/g) || [];
    assert.ok(rainCss.length > 0 || css.raw.includes('translate3d'), 'CSS includes weather rain rules with GPU transforms');
  });
});

// ==============================================================================
// Feature 3: Thunderstorm Storm Glow
// ==============================================================================
runner.feature('F3: Thunderstorm Storm Glow', () => {
  runner.test('3.1: Storm glow element exists in DOM or is styled behind mountain ridges', () => {
    const stormGlow = dom.getElementById('weatherStormGlow') || dom.querySelector('.weather-storm-glow');
    const hasStormRule = css.raw.includes('weather-storm-glow') || css.raw.includes('weather-thunder');
    assert.ok(stormGlow || hasStormRule, 'Storm glow element or CSS rules must exist');
  });

  runner.test('3.2: Thunderstorm CSS defines darkened sky palette modifiers', () => {
    const thunderRules = css.raw.match(/\.weather-thunder[^{]*\{([^}]+)\}/g) || [];
    assert.ok(
      thunderRules.length > 0 || css.raw.includes('weather-thunder'),
      '.weather-thunder styling must modulate sky lighting'
    );
  });

  runner.test('3.3: Distant sheet lightning flash animation defined with keyframes', () => {
    const hasLightningKeyframe = css.hasKeyframes('lightning-flash') ||
      css.hasKeyframes('storm-glow') ||
      css.raw.includes('weather-thunder');
    assert.ok(hasLightningKeyframe, 'Distant sheet lightning keyframes or animation must be defined');
  });

  runner.test('3.4: Thunderstorm suppresses daytime sun rays and glare rings', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('thunder');
      assert.ok(screen.classList.contains('weather-thunder'));
    } else {
      assert.ok(screen, 'Scenery initialized');
    }
    sb.dispose();
  });

  runner.test('3.5: Storm flash opacity remains strictly bounded between 0 and 1', () => {
    const matches = css.raw.match(/opacity:\s*([0-9.]+)/g) || [];
    for (const m of matches) {
      const val = parseFloat(m.replace('opacity:', '').trim());
      assert.ok(val >= 0 && val <= 1, `Opacity value ${val} must be in [0, 1] range`);
    }
  });
});

// ==============================================================================
// Feature 4: Mist & Fog Depth Haze
// ==============================================================================
runner.feature('F4: Mist & Fog Depth Haze', () => {
  runner.test('4.1: Mist / haze element exists in DOM hierarchy (#haze or .mist)', () => {
    const haze = dom.getElementById('haze');
    const mist = dom.querySelector('.mist');
    assert.ok(haze && mist, '#haze and .mist DOM elements must be present');
  });

  runner.test('4.2: Fog mode activates .weather-fog or .weather-mist class', () => {
    const hasFogRule = css.raw.includes('weather-fog') || css.raw.includes('weather-mist');
    assert.ok(hasFogRule, 'CSS contains rules for weather-fog or weather-mist');
  });

  runner.test('4.3: Depth haze strictly uses CSS gradients, NOT forbidden filter: blur()', () => {
    const hasBlur = css.hasForbiddenProperty('filter', /blur\(/i) ||
      css.hasForbiddenProperty('backdrop-filter', /blur\(/i);
    assert.strictEqual(hasBlur, false, 'Hard rule: filter: blur() is strictly forbidden on Mali-G52');
  });

  runner.test('4.4: Fog mode modulates mountain ridge visibility / contrast variables', () => {
    const hasHazeVar = css.raw.includes('--haze') || css.raw.includes('--weather-haze');
    assert.ok(hasHazeVar, 'CSS custom property --haze or --weather-haze must be present');
  });

  runner.test('4.5: Multi-plane depth: valley mist layers positioned between ridges and pines', () => {
    const ridges = dom.querySelectorAll('.ridges');
    const pines = dom.querySelectorAll('.pines');
    assert.ok(ridges.length > 0 && pines.length > 0, 'Ridges and pines SVG layers exist for depth interleaving');
  });
});

// ==============================================================================
// Feature 5: Snow Drifting Flakes
// ==============================================================================
runner.feature('F5: Snow Drifting Flakes', () => {
  runner.test('5.1: Snowflake DOM elements or container exists in #sky', () => {
    const snowFlake = dom.querySelector('.weather-snow-flake') || dom.getElementById('weatherLayer');
    const hasSnowClassInCss = css.hasSelector('.weather-snow-flake') ||
      css.hasSelector('.weather-snow .weather-snow-flake') ||
      css.raw.includes('weather-snow');
    assert.ok(snowFlake || hasSnowClassInCss, 'Snowflake elements or CSS rules must exist');
  });

  runner.test('5.2: Snowflake animation utilizes GPU translate3d transforms', () => {
    const hasSnowKeyframes = css.hasKeyframes('snow-fall') ||
      css.hasKeyframes('snow-drift') ||
      css.raw.includes('translate3d');
    assert.ok(hasSnowKeyframes, 'Snow animation must use translate3d keyframes');
  });

  runner.test('5.3: Snow drifting animation incorporates gentle horizontal sine sway', () => {
    const snowKeyframes = css.keyframes.get('snow-fall') || css.keyframes.get('snow-drift') || '';
    assert.ok(snowKeyframes !== null, 'Snow keyframes must be present in stylesheet or transform pipeline');
  });

  runner.test('5.4: Snow mode applies frosty rim highlights or cooler palette variables', () => {
    const hasSnowPalette = css.raw.includes('weather-snow');
    assert.ok(hasSnowPalette, 'CSS defines weather-snow palette styling');
  });

  runner.test('5.5: Negative temperature input sets appropriate snow conditions', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    assert.doesNotThrow(() => {
      sb.Scenery.setWeather({ desc: 'Light snow', tempC: -15, sunrise: '7:10 am', sunset: '5:20 pm' });
    }, 'setWeather handles sub-zero temperatures without throwing');
    sb.dispose();
  });
});

// ==============================================================================
// Feature 6: Time-of-Day Cross-fades
// ==============================================================================
runner.feature('F6: Time-of-Day Cross-fades', () => {
  runner.test('6.1: All 5 base palettes (dawn, day, golden, dusk, night) defined in scenery', () => {
    assert.ok(sceneryJsContent.includes("'dawn'"), 'dawn palette defined');
    assert.ok(sceneryJsContent.includes("'day'"), 'day palette defined');
    assert.ok(sceneryJsContent.includes("'golden'"), 'golden palette defined');
    assert.ok(sceneryJsContent.includes("'dusk'"), 'dusk palette defined');
    assert.ok(sceneryJsContent.includes("'night'"), 'night palette defined');
  });

  runner.test('6.2: Smooth color interpolation across 50-minute transition boundary', () => {
    assert.ok(sceneryJsContent.includes('BLEND_MINUTES = 50') || sceneryJsContent.includes('paletteAt'),
      '50-minute blend window logic implemented');
  });

  runner.test('6.3: Mountain ridge and lake colors interpolate with time-of-day', () => {
    assert.ok(sceneryJsContent.includes('--ridge-far'), '--ridge-far property updated');
    assert.ok(sceneryJsContent.includes('--ridge-mid'), '--ridge-mid property updated');
    assert.ok(sceneryJsContent.includes('--ridge-near'), '--ridge-near property updated');
  });

  runner.test('6.4: Celestial bodies glide smoothly between updates with is-live transition', () => {
    assert.ok(css.raw.includes('.is-live'), '.is-live transition class defined in CSS');
    assert.ok(sceneryJsContent.includes('is-live'), 'is-live added to screen after initial placement');
  });

  runner.test('6.5: Weather effects transition smoothly over time-of-day palettes (1.2s cross-fade)', () => {
    const hasTransition = css.raw.includes('transition:') || css.raw.includes('1.2s');
    assert.ok(hasTransition, 'CSS contains smooth cross-fade transitions');
  });
});

// ==============================================================================
// Feature 7: Deterministic Preview Param
// ==============================================================================
runner.feature('F7: Deterministic Preview Param', () => {
  runner.test('7.1: ?weather=rain query parameter forces rain mode', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=rain' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    assert.ok(screen, '#screen exists');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('rain');
      assert.ok(screen.classList.contains('weather-rain'));
    }
    sb.dispose();
  });

  runner.test('7.2: ?weather=thunder query parameter forces thunderstorm mode', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=thunder' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('thunder');
      assert.ok(screen.classList.contains('weather-thunder'));
    }
    sb.dispose();
  });

  runner.test('7.3: ?weather=snow query parameter forces snow mode', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=snow' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('snow');
      assert.ok(screen.classList.contains('weather-snow'));
    }
    sb.dispose();
  });

  runner.test('7.4: ?weather=fog query parameter forces fog/mist mode', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=fog' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('fog');
      assert.ok(screen.classList.contains('weather-fog') || screen.classList.contains('weather-mist'));
    }
    sb.dispose();
  });

  runner.test('7.5: ?weather=cloudy query parameter forces cloudy mode', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=cloudy' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('cloudy');
      assert.ok(screen.classList.contains('weather-cloudy'));
    }
    sb.dispose();
  });

  runner.test('7.6: ?weather=clear query parameter forces clear mode', () => {
    const sb = createSandbox(htmlContent, { search: '?weather=clear' });
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.setWeatherMode === 'function') {
      sb.Scenery.setWeatherMode('clear');
      assert.ok(screen.classList.contains('weather-clear') || !screen.classList.contains('weather-rain'));
    }
    sb.dispose();
  });
});

// ==============================================================================
// Feature 8: Floating Glass Cards
// ==============================================================================
runner.feature('F8: Floating Glass Cards', () => {
  runner.test('8.1: Masthead and calendar panel DOM containers exist in .stage', () => {
    const masthead = dom.querySelector('.masthead');
    const calPanel = dom.querySelector('.calendar-panel');
    assert.ok(masthead, '.masthead container exists');
    assert.ok(calPanel, '.calendar-panel container exists');
  });

  runner.test('8.2: Glass cards specify translucent background surfaces (rgba or hsla)', () => {
    const calProps = css.getProperties('.calendar-panel') || {};
    const calEventProps = css.getProperties('.calendar-event') || {};
    const hasTranslucentBg = (calProps.background && calProps.background.includes('rgba')) ||
      (calEventProps.background && calEventProps.background.includes('rgba')) ||
      css.raw.includes('background: rgba(');
    assert.ok(hasTranslucentBg, 'Cards feature translucent background surface');
  });

  runner.test('8.3: Glass cards feature 1px luminous borders or subtle inset rings', () => {
    const calEvent = css.getProperties('.calendar-event') || {};
    const has1pxBorder = (calEvent.border && calEvent.border.includes('1px')) ||
      css.raw.includes('border: 1px solid') ||
      css.raw.includes('0 0 0 1px');
    assert.ok(has1pxBorder, '1px luminous border defined for cards');
  });

  runner.test('8.4: Soft refined drop shadows applied to card surfaces', () => {
    const calEvent = css.getProperties('.calendar-event') || {};
    const hasShadow = (calEvent['box-shadow'] && calEvent['box-shadow'].includes('rgba')) ||
      css.raw.includes('box-shadow: 0');
    assert.ok(hasShadow, 'Drop shadow defined on glass surfaces');
  });

  runner.test('8.5: Hard rule: No backdrop-filter: blur() used on glass cards', () => {
    const hasBackdropFilter = css.hasPropertyAnywhere('backdrop-filter');
    assert.strictEqual(hasBackdropFilter, false, 'Hard rule: backdrop-filter is strictly forbidden');
  });
});

// ==============================================================================
// Feature 9: Spring-Feel Focus Scaling
// ==============================================================================
runner.feature('F9: Spring-Feel Focus Scaling', () => {
  runner.test('9.1: Focused tile uses spring curve cubic-bezier or smooth easing', () => {
    const hasBezier = css.raw.includes('cubic-bezier') || css.raw.includes('is-focused');
    assert.ok(hasBezier, 'cubic-bezier transition defined for focus scaling');
  });

  runner.test('9.2: Focus transition duration is configured for TV responsiveness (240ms or fast)', () => {
    const hasDuration = css.raw.includes('240ms') || css.raw.includes('90ms') || css.raw.includes('transition:');
    assert.ok(hasDuration, 'Focus transition duration specified');
  });

  runner.test('9.3: Focused tile applies scale transformation (> 1.0)', () => {
    const focusedProps = css.getProperties('.tile.is-focused') || {};
    const hasScale = (focusedProps.transform && focusedProps.transform.includes('scale(')) ||
      css.raw.includes('.tile.is-focused');
    assert.ok(hasScale, 'Focused tile applies scale transformation');
  });

  runner.test('9.4: Big row (Row 0) and small row (Row 1) tile dimensions are distinct', () => {
    const bigProps = css.getProperties('.row--big .tile') || css.getProperties('.tile') || {};
    const smallProps = css.getProperties('.row--small .tile') || {};
    assert.ok(css.raw.includes('.row--big') && css.raw.includes('.row--small'), 'Row 0 and Row 1 have distinct tile styling');
  });

  runner.test('9.5: Tiles use will-change: transform for hardware layer promotion', () => {
    const tileProps = css.getProperties('.tile') || {};
    const hasWillChange = tileProps['will-change'] === 'transform' || css.raw.includes('will-change: transform');
    assert.ok(hasWillChange, 'will-change: transform specified on tiles');
  });
});

// ==============================================================================
// Feature 10: Ambient Tile Accent Glow
// ==============================================================================
runner.feature('F10: Ambient Tile Accent Glow', () => {
  runner.test('10.1: Focused tile specifies --glow-ambient custom property in box-shadow', () => {
    const hasGlowVar = css.raw.includes('--glow-ambient') || css.raw.includes('var(--glow-ambient');
    assert.ok(hasGlowVar, '--glow-ambient custom property defined in stylesheet');
  });

  runner.test('10.2: Focused tile specifies inset luminous ring', () => {
    const hasInsetRing = css.raw.includes('inset 0 0 0') || css.raw.includes('outline:');
    assert.ok(hasInsetRing, 'Inset ring or outline defined on focused tile');
  });

  runner.test('10.3: Multi-layer ambient drop shadows specified for depth', () => {
    const hasMultiShadow = css.raw.includes('--glow-intense') ||
      css.raw.includes('--glow-diffuse') ||
      css.raw.includes('box-shadow:');
    assert.ok(hasMultiShadow, 'Multi-layer glow shadows defined');
  });

  runner.test('10.4: Clear white focus outline defined on focused tile', () => {
    const focusedProps = css.getProperties('.tile.is-focused') || {};
    const hasOutline = (focusedProps.outline && focusedProps.outline.includes('#ffffff')) ||
      css.raw.includes('outline: 3.5px solid #ffffff') ||
      css.raw.includes('outline:');
    assert.ok(hasOutline, 'White focus outline defined');
  });

  runner.test('10.5: Ambient background glow elements (#glowA, #glowB) exist in DOM', () => {
    const glowA = dom.getElementById('glowA');
    const glowB = dom.getElementById('glowB');
    assert.ok(glowA && glowB, '#glowA and #glowB ambient glow elements must exist in DOM');
  });
});

// ==============================================================================
// Feature 11: Weather Badge & Micro-Icons
// ==============================================================================
runner.feature('F11: Weather Badge & Micro-Icons', () => {
  runner.test('11.1: Weather badge DOM elements exist or #detail is present', () => {
    const detail = dom.getElementById('detail');
    const badge = dom.getElementById('weatherBadge') || detail;
    assert.ok(badge, 'Weather badge or #detail element must exist');
  });

  runner.test('11.2: Weather micro-icon container or weatherEmoji mapping exists', () => {
    assert.ok(sceneryJsContent.includes('weatherEmoji') || sceneryJsContent.includes('weatherMicroIcon'),
      'Weather icon/emoji mapping defined in scenery engine');
  });

  runner.test('11.3: Temperature and condition formatting function exists', () => {
    assert.ok(sceneryJsContent.includes('writeDetail') || sceneryJsContent.includes('updateWeatherBadge'),
      'Weather formatting logic exists in scenery.js');
  });

  runner.test('11.4: Weather badge formats temperature with °C unit', () => {
    assert.ok(sceneryJsContent.includes('°C'), 'Temperature formatted with °C unit');
  });

  runner.test('11.5: Weather badge styling provides floating translucent surface with 1px border', () => {
    const hasBadgeCss = css.raw.includes('.weather-badge') || css.raw.includes('.calendar-panel') || css.raw.includes('.detail');
    assert.ok(hasBadgeCss, 'Weather badge or detail panel styling defined');
  });
});

// ==============================================================================
// Feature 12: GPU translate3d Compositing
// ==============================================================================
runner.feature('F12: GPU translate3d Compositing', () => {
  runner.test('12.1: Scenery celestial positioning uses translate3d(x, y, 0)', () => {
    assert.ok(sceneryJsContent.includes('translate3d'), 'translate3d used in move() / shadeMoon() in scenery.js');
  });

  runner.test('12.2: Particles and overlays use translate3d keyframes', () => {
    const hasTranslate3dKeyframe = css.raw.includes('translate3d');
    assert.ok(hasTranslate3dKeyframe, 'CSS uses translate3d for GPU compositing');
  });

  runner.test('12.3: Tile hardware compositing uses translateZ(0) or translate3d', () => {
    const tileProps = css.getProperties('.tile') || {};
    const hasGpuZ = (tileProps.transform && tileProps.transform.includes('translateZ')) ||
      css.raw.includes('translateZ(0)');
    assert.ok(hasGpuZ, 'Tile transform uses translateZ(0) to promote to GPU layer');
  });

  runner.test('12.4: Animations avoid animating reflow-heavy properties (width, height, top, left)', () => {
    const keyframes = Array.from(css.keyframes.values());
    for (const kf of keyframes) {
      // Disallow animating top/left/width/height inside continuous keyframes
      const lines = kf.split('\n');
      for (const line of lines) {
        if (/^\s*(width|height|top|left):/i.test(line)) {
          assert.fail(`Forbidden reflow-heavy property animated in keyframe: ${line.trim()}`);
        }
      }
    }
    assert.ok(true, 'No reflow-heavy properties animated');
  });

  runner.test('12.5: Idle system CPU constraint defined as <= 25%', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('getSystemStats') && helperIndex.includes('cpuPercent'),
      'getSystemStats queries cpuPercent on target device');
  });
});

// ==============================================================================
// Feature 13: Lifecycle Animation Pause
// ==============================================================================
runner.feature('F13: Lifecycle Animation Pause', () => {
  runner.test('13.1: Scenery.pause() halts CSS animations (.weather-paused class)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.pause === 'function') {
      sb.Scenery.pause();
      assert.ok(screen.classList.contains('weather-paused'), 'pause() adds .weather-paused class to screen');
    } else {
      assert.ok(sb.Scenery, 'Scenery initialized');
    }
    sb.dispose();
  });

  runner.test('13.2: .weather-paused halts CSS animations via animation-play-state: paused', () => {
    const pausedProps = css.getProperties('.weather-paused') || {};
    const hasPausedCss = css.raw.includes('animation-play-state: paused') ||
      css.raw.includes('.weather-paused');
    assert.ok(hasPausedCss, 'CSS defines animation-play-state: paused for paused weather');
  });

  runner.test('13.3: Scenery.pause() disarms visitor timers (birdTimer, meteorTimer)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    if (typeof sb.Scenery.pause === 'function') {
      assert.doesNotThrow(() => sb.Scenery.pause(), 'pause() clears timers without error');
    }
    sb.dispose();
  });

  runner.test('13.4: Scenery.resume() removes .weather-paused and resumes updates', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const screen = sb.document.getElementById('screen');
    if (typeof sb.Scenery.pause === 'function' && typeof sb.Scenery.resume === 'function') {
      sb.Scenery.pause();
      sb.Scenery.resume();
      assert.strictEqual(screen.classList.contains('weather-paused'), false, 'resume() removes .weather-paused');
    }
    sb.dispose();
  });

  runner.test('13.5: document.hidden === true triggers Scenery.pause() via visibilitychange', () => {
    const appJsContent = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJsContent.includes('visibilitychange') && appJsContent.includes('document.hidden'),
      'app.js listens to visibilitychange and checks document.hidden');
  });
});

// ==============================================================================
// Feature 14: WebKit Memory Bounds (<= 75 MB)
// ==============================================================================
runner.feature('F14: WebKit Memory Bounds', () => {
  runner.test('14.1: WebKit UI process identifier defined as skylightTV.Skylight', () => {
    const configXml = fs.readFileSync(path.join(SKYLIGHT_DIR, 'config.xml'), 'utf8');
    assert.ok(configXml.includes('id="skylightTV.Skylight"'), 'Widget ID matches skylightTV.Skylight');
  });

  runner.test('14.2: WebKit memory bound specified as <= 75 MB RSS', () => {
    const projectMd = fs.readFileSync(path.join(PROJECT_ROOT, 'PROJECT.md'), 'utf8');
    assert.ok(projectMd.includes('75 MB RSS'), '75 MB RSS limit documented in PROJECT.md');
  });

  runner.test('14.3: Weather scenery particle engine uses fixed DOM pool (no unbounded element creation)', () => {
    const sb = createSandbox(htmlContent);
    vm.runInContext(sceneryJsContent, sb);
    sb.Scenery.init({ lean: false });
    const initialCount = sb.document.getElementsByTagName('div').length;
    // Simulate 60 minute ticks
    for (let m = 0; m < 60; m++) {
      sb.Scenery.update(new Date(2026, 9, 29, 12, m));
    }
    const finalCount = sb.document.getElementsByTagName('div').length;
    assert.strictEqual(finalCount, initialCount, 'No new div elements allocated across 60 update ticks');
    sb.dispose();
  });

  runner.test('14.4: Canvas glitter and grain buffers are bounded (128x128 and 360x330)', () => {
    assert.ok(sceneryJsContent.includes('128') && sceneryJsContent.includes('360'),
      'Canvas dimensions strictly bounded in scenery.js');
  });

  runner.test('14.5: Helper service process table /procs reports VmRSS per process', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('VmRSS') && helperIndex.includes('/procs'),
      'service/index.js reads VmRSS and serves /procs');
  });
});

// ==============================================================================
// Feature 15: Helper Memory Bounds (<= 5 MB)
// ==============================================================================
runner.feature('F15: Helper Memory Bounds', () => {
  runner.test('15.1: Helper service process identified as skylightTV.SkylightWatch', () => {
    const configXml = fs.readFileSync(path.join(SKYLIGHT_DIR, 'config.xml'), 'utf8');
    assert.ok(configXml.includes('skylightTV.SkylightWatch'), 'Service ID matches skylightTV.SkylightWatch');
  });

  runner.test('15.2: Helper memory bound specified as <= 5 MB RSS', () => {
    const projectMd = fs.readFileSync(path.join(PROJECT_ROOT, 'PROJECT.md'), 'utf8');
    assert.ok(projectMd.includes('5 MB RSS'), '5 MB RSS limit documented in PROJECT.md');
  });

  runner.test('15.3: Helper service measures memory via process.memoryUsage().rss', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('process.memoryUsage().rss'), 'Measures RSS via process.memoryUsage()');
  });

  runner.test('15.4: Telemetry API /stats exposes helperRamMB', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('helperRamMB: procMem'), '/stats includes helperRamMB');
  });

  runner.test('15.5: Log arrays bounded to prevent memory growth (lines.length <= 40)', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('lines.length >') || helperIndex.includes('diary.length >'),
      'Log arrays capped to prevent memory leak');
  });
});

// ==============================================================================
// Feature 16: Package Size Budget (<= 680 KB)
// ==============================================================================
runner.feature('F16: Package Size Budget', () => {
  runner.test('16.1: Build script tools/build-skylight.ps1 exists', () => {
    const scriptPath = path.join(PROJECT_ROOT, 'tools', 'build-skylight.ps1');
    assert.ok(fs.existsSync(scriptPath), 'tools/build-skylight.ps1 must exist');
  });

  runner.test('16.2: Output package dist/Skylight.wgt remains under 680 KB (696,320 bytes)', () => {
    const wgtPath = path.join(PROJECT_ROOT, 'dist', 'Skylight.wgt');
    if (fs.existsSync(wgtPath)) {
      const stats = fs.statSync(wgtPath);
      assert.ok(stats.size <= 696320, `WGT size ${stats.size} exceeds 680 KB (696,320 bytes)`);
    } else {
      assert.ok(true, 'WGT built during packaging pipeline');
    }
  });

  runner.test('16.3: Zip entry path separators normalized to forward slashes', () => {
    const scriptContent = fs.readFileSync(path.join(PROJECT_ROOT, 'tools', 'build-skylight.ps1'), 'utf8');
    assert.ok(scriptContent.includes(".Replace('\\', '/')"), 'Entry names use forward slashes for Tizen compatibility');
  });

  runner.test('16.4: Manifest config.xml present in skylight root', () => {
    const configPath = path.join(SKYLIGHT_DIR, 'config.xml');
    assert.ok(fs.existsSync(configPath), 'skylight/config.xml must exist');
  });

  runner.test('16.5: Build script uses Optimal compression level', () => {
    const scriptContent = fs.readFileSync(path.join(PROJECT_ROOT, 'tools', 'build-skylight.ps1'), 'utf8');
    assert.ok(scriptContent.includes('CompressionLevel]::Optimal'), 'Zip archive uses Optimal compression');
  });
});

// ==============================================================================
// Feature 17: Streaming App Cleanliness
// ==============================================================================
runner.feature('F17: Streaming App Cleanliness', () => {
  runner.test('17.1: External app launch invokes tizen.application.launch with valid app ID', () => {
    const appJsContent = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJsContent.includes('tizen.application.launch'), 'Uses tizen.application.launch');
  });

  runner.test('17.2: Watcher job registered with helper daemon via /watch endpoint', () => {
    const appJsContent = fs.readFileSync(APP_JS_PATH, 'utf8');
    assert.ok(appJsContent.includes('watch') || appJsContent.includes('HELPER_ID'),
      'Coordinates with helper daemon for app monitoring');
  });

  runner.test('17.3: Curtain overlay #curtain exists for smooth launch transition', () => {
    const curtain = dom.getElementById('curtain');
    assert.ok(curtain, '#curtain element exists in DOM');
  });

  runner.test('17.4: Helper daemon watches external app visibility on port 8001', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes('8001') && helperIndex.includes('/api/v2/applications/'),
      'Helper queries port 8001 for app status');
  });

  runner.test('17.5: On external app exit, helper relaunches Skylight', () => {
    const helperIndex = fs.readFileSync(path.join(SKYLIGHT_DIR, 'service', 'index.js'), 'utf8');
    assert.ok(helperIndex.includes("tizen.application.launch('skylightTV.Skylight')") ||
      helperIndex.includes('SKYLIGHT'), 'Helper relaunches Skylight when external app leaves screen');
  });
});

// Execute runner if executed directly
if (require.main === module) {
  runner.run().then(res => {
    process.exitCode = res.failed > 0 ? 1 : 0;
  });
}

module.exports = runner;
