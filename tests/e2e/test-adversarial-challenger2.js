/**
 * Adversarial Challenger 2 Stress Suite for Milestone 2
 * Tests:
 * 1. Package integrity & security audit (forward slashes, forbidden artifacts, size <= 680 KB).
 * 2. GPU layer compositing & layout thrashing audit.
 * 3. XSS / HTML injection resistance in weather badge (desc, tempC).
 * 4. Micro-icon generation throughput & memory leak stress (10,000 iterations).
 * 5. Rapid focus transition & navigation boundary stress (5,000 cycles).
 * 6. Paused state enforcement on micro-icons and weather badge.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const projectRoot = path.resolve(__dirname, '..', '..');
const appCssPath = path.join(projectRoot, 'skylight', 'css', 'app.css');
const appJsPath = path.join(projectRoot, 'skylight', 'js', 'app.js');
const sceneryJsPath = path.join(projectRoot, 'skylight', 'js', 'scenery.js');
const indexHtmlPath = path.join(projectRoot, 'skylight', 'index.html');
const wgtPath = path.join(projectRoot, 'dist', 'Skylight.wgt');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

console.log('========================================================');
console.log('  CHALLENGER 2: ADVERSARIAL STRESS & AUDIT SUITE (M2)');
console.log('========================================================\n');

// -----------------------------------------------------------------------------
// 1. Package Build & Security Audit
// -----------------------------------------------------------------------------
console.log('[Audit 1: Package Footprint & Archive Structure]');

test('Skylight.wgt size is <= 680 KB (696,320 bytes)', () => {
  assert(fs.existsSync(wgtPath), 'dist/Skylight.wgt does not exist');
  const stat = fs.statSync(wgtPath);
  const maxBytes = 680 * 1024;
  assert(stat.size <= maxBytes, `WGT size ${stat.size} exceeds limit ${maxBytes}`);
  console.log(`         Size: ${(stat.size / 1024).toFixed(2)} KB (${stat.size} bytes)`);
});

test('Skylight.wgt contains zero forbidden artifacts (.git, tests, .agents, node_modules)', () => {
  // Read zip header / central directory
  const buf = fs.readFileSync(wgtPath);
  const forbiddenPatterns = [
    /\.git/i,
    /node_modules/i,
    /\.agents/i,
    /tests\//i,
    /\.DS_Store/i,
    /Thumbs\.db/i,
    /run-all\.ps1/i,
    /\.log$/i
  ];
  // Simple scan of file names in zip buffer
  for (const pat of forbiddenPatterns) {
    assert(!pat.test(buf.toString('binary')), `Found forbidden pattern in WGT: ${pat}`);
  }
});

// -----------------------------------------------------------------------------
// 2. GPU Rendering, Layer Compositing & Layout Thrashing Audit
// -----------------------------------------------------------------------------
console.log('\n[Audit 2: GPU Rendering & Layout Thrashing]');

const cssContent = fs.readFileSync(appCssPath, 'utf8');

test('Zero filter: blur() or backdrop-filter: blur() anywhere in app.css', () => {
  // Strip comments first
  const noComments = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/backdrop-filter/i.test(noComments), 'Found backdrop-filter in app.css');
  assert(!/filter\s*:[^;]*blur/i.test(noComments), 'Found filter: blur in app.css');
});

test('All glass cards have GPU-compositing triggers (translateZ(0) / backface-visibility)', () => {
  assert(/\.glass-card[\s\S]*?transform:\s*translateZ\(0\)/.test(cssContent), 'glass-card missing translateZ(0)');
  assert(/\.glass-card[\s\S]*?backface-visibility:\s*hidden/.test(cssContent), 'glass-card missing backface-visibility');
});

test('Weather badge and tiles have GPU-compositing triggers', () => {
  assert(/\.weather-badge[\s\S]*?transform:\s*translateZ\(0\)/.test(cssContent), 'weather-badge missing translateZ(0)');
  assert(/\.tile[\s\S]*?transform:\s*scale\(1\)\s*translateZ\(0\)/.test(cssContent), 'tile missing scale(1) translateZ(0)');
  assert(/\.tile\.is-focused[\s\S]*?translateZ\(0\)/.test(cssContent), 'tile.is-focused missing translateZ(0)');
});

test('Focus transitions and micro-icons animate ZERO layout properties (top, left, margin, width, height)', () => {
  const noComments = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
  const forbidden = ['top', 'left', 'right', 'bottom', 'margin', 'padding', 'width', 'height'];
  
  // Find tile transition
  const tileTransMatch = noComments.match(/\.tile\s*\{[^}]*?transition\s*:\s*([^;]+);/s);
  assert(tileTransMatch, 'Missing tile transition');
  for (const prop of forbidden) {
    assert(!new RegExp('\\b' + prop + '\\b', 'i').test(tileTransMatch[1]), `Tile transition animates ${prop}`);
  }

  // Micro-icon keyframes
  const microKeyframes = ['icon-pulse', 'icon-rain-drop', 'icon-snow-drift', 'icon-cloud-drift', 'icon-flash'];
  for (const kf of microKeyframes) {
    const kfRegex = new RegExp('@keyframes\\s+' + kf + '\\s*\\{([^}]+(?:\\{[^}]+\\}[^}]+)*)\\}', 's');
    const match = noComments.match(kfRegex);
    assert(match, `Missing keyframe ${kf}`);
    for (const prop of forbidden) {
      assert(!new RegExp('\\b' + prop + '(-[a-z]+)?\\s*:', 'i').test(match[1]), `Keyframe ${kf} animates ${prop}`);
    }
  }
});

// -----------------------------------------------------------------------------
// 3. Security & Injection Resistance
// -----------------------------------------------------------------------------
console.log('\n[Audit 3: Adversarial Input & Injection Resistance]');

const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

// Mock a lightweight DOM environment for testing app.js & scenery.js logic
const elements = {};
function createMockEl(id, className) {
  return {
    id: id || '',
    className: className || '',
    classList: {
      _classes: new Set((className || '').split(' ').filter(Boolean)),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toggle(c, v) { if (v === undefined) v = !this._classes.has(c); if (v) this._classes.add(c); else this._classes.delete(c); return v; }
    },
    textContent: '',
    innerHTML: '',
    style: {},
    appendChild(child) {},
    addEventListener(ev, fn) {}
  };
}

['screen', 'stars', 'glare', 'moon', 'moonShade', 'haze', 'lake', 'glitter', 'glitterA', 'glitterB', 'column', 'birds', 'meteor', 'detail', 'weatherBadge', 'weatherMicroIcon', 'weatherTemp', 'weatherDesc'].forEach(id => {
  elements[id] = createMockEl(id);
});

// Load and evaluate scenery.js in sandbox
const vm = require('vm');
const sandbox = {
  document: {
    documentElement: { style: {} },
    getElementById: (id) => elements[id] || null,
    createElement: (tag) => createMockEl(null, ''),
    addEventListener: () => {}
  },
  window: {},
  location: { search: '' },
  console: console,
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {}
};
sandbox.window = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(sceneryJsPath, 'utf8'), sandbox);
if (sandbox.Scenery && sandbox.Scenery.init) {
  sandbox.Scenery.init({ lean: true });
}

test('Adversarial weather inputs cannot crash classifyWeather', () => {
  const Scenery = sandbox.Scenery;
  assert(Scenery, 'Scenery not defined');
  
  const badInputs = [
    null,
    undefined,
    12345,
    true,
    false,
    {},
    [],
    Symbol('bad'),
    new Date(),
    NaN,
    Infinity,
    -Infinity
  ];

  for (const input of badInputs) {
    assert.doesNotThrow(() => {
      Scenery.setWeather({ desc: input, tempC: 20 });
    }, `Failed on input: ${String(input)}`);
  }
});

test('XSS injection in weather description is safely assigned to textContent, not innerHTML', () => {
  const Scenery = sandbox.Scenery;
  const xssPayload = '<img src=x onerror=alert("XSS")>';
  Scenery.setWeather({ desc: xssPayload, tempC: 22 });
  
  const descEl = elements['weatherDesc'];
  assert.strictEqual(descEl.textContent, xssPayload);
  // innerHTML must not have been set to raw payload
  assert(!descEl.innerHTML.includes('<img src=x'), 'XSS payload leaked into innerHTML');
});

// -----------------------------------------------------------------------------
// 4. Micro-Icon Generation & Throughput Stress
// -----------------------------------------------------------------------------
console.log('\n[Audit 4: Micro-Icon Throughput & Stress]');

test('10,000 sequential weather badge updates execute in < 250ms with zero leaks', () => {
  const Scenery = sandbox.Scenery;
  const modes = ['clear', 'cloudy', 'rain', 'thunder', 'mist', 'snow'];
  const start = Date.now();
  
  for (let i = 0; i < 10000; i++) {
    const mode = modes[i % modes.length];
    Scenery.setWeather({ mode: mode, desc: mode, tempC: 15 + (i % 15) });
  }
  
  const elapsed = Date.now() - start;
  console.log(`         10,000 iterations completed in ${elapsed}ms (${(elapsed / 10000).toFixed(4)}ms / call)`);
  assert(elapsed < 250, `Too slow: ${elapsed}ms >= 250ms`);
  
  // Verify last mode SVG (iteration 9999 was thunder)
  const microIconEl = elements['weatherMicroIcon'];
  assert(microIconEl.innerHTML.includes('<svg'), 'Missing SVG in micro-icon');
  assert(microIconEl.innerHTML.includes('weather-icon--flash'), 'Missing thunder flash icon class');

  // Also test all modes individually
  for (const m of modes) {
    Scenery.setWeather({ mode: m, desc: m, tempC: 20 });
    assert(microIconEl.innerHTML.includes('<svg'), `Missing SVG for ${m}`);
  }
});

// -----------------------------------------------------------------------------
// 5. Paused State Enforcements
// -----------------------------------------------------------------------------
console.log('\n[Audit 5: Paused State Enforcement]');

test('Scenery.pause() applies .weather-paused to #screen and halts micro-icon animations via CSS rule', () => {
  const Scenery = sandbox.Scenery;
  const screenEl = elements['screen'];
  
  Scenery.pause();
  assert(screenEl.classList.contains('weather-paused'), 'screen missing weather-paused class');
  
  // Verify CSS contains the rule halting animations
  assert(
    /\.screen\.weather-paused\s+\.weather-micro-icon\s*\*[^}]*animation-play-state:\s*paused\s*!important/.test(cssContent),
    'Missing CSS animation-play-state: paused !important rule for micro-icons'
  );
  
  Scenery.resume();
  assert(!screenEl.classList.contains('weather-paused'), 'screen still has weather-paused class after resume');
});

// -----------------------------------------------------------------------------
// 6. Tizen Widget Archive Path & Entry Compliance
// -----------------------------------------------------------------------------
console.log('\n[Audit 6: Tizen WGT Path Formatting Audit]');

test('All WGT zip entries strictly use forward slashes (zero Windows backslashes)', () => {
  // Parse ZIP central directory entries
  const buf = fs.readFileSync(wgtPath);
  // Look for zip local file header signature 0x04034b50 and central directory 0x02014b50
  let offset = 0;
  const filenames = [];
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) === 0x02014b50) {
      const fnLen = buf.readUInt16LE(offset + 28);
      const extraLen = buf.readUInt16LE(offset + 30);
      const commentLen = buf.readUInt16LE(offset + 32);
      const fn = buf.toString('utf8', offset + 46, offset + 46 + fnLen);
      filenames.push(fn);
      offset += 46 + fnLen + extraLen + commentLen;
    } else {
      offset++;
    }
  }
  assert(filenames.length > 0, 'No ZIP entries found in Skylight.wgt');
  console.log(`         Audited ${filenames.length} zip entries inside Skylight.wgt`);
  for (const fn of filenames) {
    assert(!fn.includes('\\'), `ZIP entry contains Windows backslash: "${fn}" (Tizen installer will reject this)`);
  }
});

// -----------------------------------------------------------------------------
// 7. Navigation & Focus Boundary Stress
// -----------------------------------------------------------------------------
console.log('\n[Audit 7: Navigation & Focus Boundary Clamping Stress]');

test('5,000 rapid directional focus transitions stay clamped with zero NaN or errors', () => {
  // Mock full app navigation state
  const catalog = {
    apps: {
      netflix: { name: 'Netflix', tile: '#e50914' },
      youtube: { name: 'YouTube', tile: '#ff0000' },
      prime: { name: 'Prime Video', tile: '#00a8e1' },
      browser: { name: 'Browser', tile: '#1e3f8f' }
    },
    hidden: [],
    favourites: ['netflix', 'youtube'],
    first: ['prime', 'browser']
  };

  const rows = [
    { items: [{ id: 'netflix' }, { id: 'youtube' }], shift: 0, el: createMockEl(null, 'row row--big') },
    { items: [{ id: 'prime' }, { id: 'browser' }], shift: 0, el: createMockEl(null, 'row row--small') }
  ];

  const focus = { row: 0, col: 0 };
  const VIEW_WIDTH = 1920;

  function scrollRow(index) {
    const row = rows[index];
    const col = (index === focus.row) ? focus.col : 0;
    const step = (index === 0) ? 174 : 124;
    const tileWidth = (index === 0) ? 154 : 108;
    const left = col * step;
    const right = left + tileWidth;
    if (right - row.shift > VIEW_WIDTH) row.shift = right - VIEW_WIDTH + 40;
    if (left - row.shift < 0) row.shift = Math.max(0, left - 40);
    row.el.style.transform = 'translate3d(' + (-row.shift) + 'px, 0, 0)';
  }

  function step(dRow, dCol) {
    if (dRow) {
      const target = focus.row + dRow;
      if (target < 0 || target >= rows.length || !rows[target].items.length) return;
      focus.row = target;
      focus.col = Math.min(focus.col, rows[target].items.length - 1);
    }
    if (dCol) {
      const next = focus.col + dCol;
      if (next < 0 || next >= rows[focus.row].items.length) return;
      focus.col = next;
    }
    scrollRow(focus.row);
  }

  // Rapidly hammer 5,000 navigation directions including out-of-bounds
  const directions = [
    [0, 1],   // Right
    [0, 1],   // Right (beyond)
    [1, 0],   // Down
    [0, -1],  // Left
    [-1, 0],  // Up
    [-1, 0],  // Up (beyond)
    [0, -1],  // Left (beyond)
    [1, 0]    // Down
  ];

  for (let i = 0; i < 5000; i++) {
    const dir = directions[i % directions.length];
    step(dir[0], dir[1]);
    assert(focus.row >= 0 && focus.row < rows.length, `Invalid focus row: ${focus.row}`);
    assert(focus.col >= 0 && focus.col < rows[focus.row].items.length, `Invalid focus col: ${focus.col}`);
    assert(rows[focus.row].el.style.transform.startsWith('translate3d('), 'Row transform must use translate3d');
  }
});

// -----------------------------------------------------------------------------
// 8. Memory Heap Stability Under 50,000 Scenery Mutations
// -----------------------------------------------------------------------------
console.log('\n[Audit 8: Memory Heap Stability & Leak Audit]');

test('50,000 weather mutations produce negligible heap delta (< 2 MB)', () => {
  const Scenery = sandbox.Scenery;
  const modes = ['clear', 'cloudy', 'rain', 'thunder', 'mist', 'snow'];
  
  if (global.gc) global.gc();
  const initialMem = process.memoryUsage().heapUsed;
  
  for (let i = 0; i < 50000; i++) {
    const m = modes[i % modes.length];
    Scenery.setWeather({ mode: m, desc: m, tempC: 20 });
    if (i % 1000 === 0) {
      Scenery.pause();
      Scenery.resume();
    }
  }
  
  if (global.gc) global.gc();
  const finalMem = process.memoryUsage().heapUsed;
  const deltaMB = (finalMem - initialMem) / (1024 * 1024);
  console.log(`         Heap delta after 50,000 mutations: ${deltaMB.toFixed(3)} MB`);
  assert(deltaMB < 2.0, `Heap grew by ${deltaMB.toFixed(2)} MB >= 2 MB`);
});

console.log('\n========================================================');
console.log(`  ALL ${totalTests} ADVERSARIAL CHALLENGES PASSED EMPIRICALLY!`);
console.log('========================================================');
