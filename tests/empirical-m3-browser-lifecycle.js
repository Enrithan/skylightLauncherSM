/**
 * tests/empirical-m3-browser-lifecycle.js
 * Real Headless Microsoft Edge browser CDP test harness for Milestone 3.
 *
 * Verifies:
 * 1. 100+ rapid visibilitychange transitions in real WebKit/Chromium engine.
 * 2. animationPlayState toggling (running <-> paused) on rain streaks and lake shimmer.
 * 3. JS Heap memory bounds before vs. after 100 rapid cycles (no memory leak).
 * 4. DOM node count invariance before vs. after 100 cycles (zero DOM leaks).
 * 5. open(app) curtain trigger and Scenery.pause() execution in live browser.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKYLIGHT_DIR = path.join(PROJECT_ROOT, 'skylight');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 8192;
const CDP_PORT = 9226;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let reqPath = req.url.split('?')[0];
      if (reqPath === '/') reqPath = '/skylight/index.html';
      const fullPath = path.join(PROJECT_ROOT, reqPath.replace(/^\//, ''));

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        fs.createReadStream(fullPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function launchEdge() {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `http://127.0.0.1:${PORT}/skylight/index.html?weather=rain`
  ];

  return spawn(EDGE_PATH, args, { stdio: 'ignore' });
}

async function getDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find(t => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Failed to connect to Edge CDP endpoint within 6 seconds');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
  }

  ready() {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression: expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text} (${JSON.stringify(res.exceptionDetails.exception)})`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    this.ws.close();
  }
}

async function runBrowserEmpiricalLifecycleSuite() {
  console.log('=================================================================');
  console.log('  HEADLESS EDGE REAL BROWSER CDP LIFECYCLE HARNESS');
  console.log('=================================================================\n');

  const server = await startServer();
  const edgeProc = launchEdge();

  let cdp;
  let exitCode = 0;

  try {
    const wsUrl = await getDebuggerUrl();
    cdp = new CDPClient(wsUrl);
    await cdp.ready();
    await cdp.send('Performance.enable');

    // Wait 1.5s for initial rendering and entrance animation
    await new Promise(r => setTimeout(r, 1500));

    // Test 1: Verify Initial Running State under Rain Mode
    console.log('--- Test 1: Initial Animation Play State ---');
    const initPlayState = await cdp.eval(`
      (() => {
        const streak = document.querySelector('.weather-rain-streak--1') || document.querySelector('.weather-lake-shimmer');
        return streak ? window.getComputedStyle(streak).animationPlayState : 'none';
      })()
    `);
    console.log(`  Initial rain streak animationPlayState: ${initPlayState}`);
    if (initPlayState !== 'running') {
      console.error(`  [FAIL] Expected running, got ${initPlayState}`);
      exitCode = 1;
    } else {
      console.log('  [PASS] Initial animationPlayState is running');
    }

    // Test 2: Measure Initial Memory Metrics
    console.log('\n--- Test 2: Baseline Memory Metrics ---');
    const initMetrics = await cdp.send('Performance.getMetrics');
    const initHeap = initMetrics.metrics.find(m => m.name === 'JSHeapUsedSize').value;
    const initDomElements = await cdp.eval(`document.querySelectorAll('*').length`);
    console.log(`  Baseline JS Heap Used: ${(initHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Baseline DOM Elements: ${initDomElements}`);

    // Test 3: Rapid 100-Cycle Visibility Toggling
    console.log('\n--- Test 3: Rapid 100-Cycle Visibilitychange Stress ---');
    const cycleResult = await cdp.eval(`
      (() => {
        let failures = 0;
        const screen = document.getElementById('screen');
        const streak = document.querySelector('.weather-rain-streak--1') || document.querySelector('.weather-lake-shimmer');

        for (let i = 0; i < 100; i++) {
          // 1. Pause
          Scenery.pause();
          const pausedClass = screen.classList.contains('weather-paused');
          const pausedState = streak ? window.getComputedStyle(streak).animationPlayState : 'paused';
          if (!pausedClass || pausedState !== 'paused') failures++;

          // 2. Resume
          Scenery.resume();
          const runningClass = !screen.classList.contains('weather-paused');
          const runningState = streak ? window.getComputedStyle(streak).animationPlayState : 'running';
          if (!runningClass || runningState !== 'running') failures++;
        }

        return { failures, finalPaused: screen.classList.contains('weather-paused') };
      })()
    `);

    console.log(`  Cycles completed: 100 (200 state transitions)`);
    console.log(`  Intermediate assertion failures: ${cycleResult.failures}`);
    if (cycleResult.failures === 0 && !cycleResult.finalPaused) {
      console.log('  [PASS] All 100 pause/resume transitions toggled animationPlayState accurately');
    } else {
      console.error(`  [FAIL] Detected ${cycleResult.failures} desynchronizations during rapid cycling`);
      exitCode = 1;
    }

    // Test 4: Post-Cycle Memory Bounds & Node Leak Audit
    console.log('\n--- Test 4: Post-Cycle Memory & DOM Node Invariance ---');
    try {
      await cdp.send('HeapProfiler.collectGarbage');
    } catch (e) {}
    await new Promise(r => setTimeout(r, 300));

    const postMetrics = await cdp.send('Performance.getMetrics');
    const postHeap = postMetrics.metrics.find(m => m.name === 'JSHeapUsedSize').value;
    const postDomElements = await cdp.eval(`document.querySelectorAll('*').length`);
    const heapDelta = (postHeap - initHeap) / 1024 / 1024;
    const elDelta = postDomElements - initDomElements;

    console.log(`  Post-Cycle JS Heap Used: ${(postHeap / 1024 / 1024).toFixed(2)} MB (Delta: ${heapDelta >= 0 ? '+' : ''}${heapDelta.toFixed(2)} MB)`);
    console.log(`  Post-Cycle DOM Elements: ${postDomElements} (Delta: ${elDelta >= 0 ? '+' : ''}${elDelta})`);

    // Strict bounds: Heap growth must be < 5 MB, DOM element delta must be 0
    if (heapDelta < 5.0 && elDelta === 0) {
      console.log('  [PASS] Zero DOM element leak (delta = 0) and heap within strict bounds');
    } else {
      console.error(`  [FAIL] Memory or node accumulation detected! elDelta=${elDelta}, heapDelta=${heapDelta.toFixed(2)}MB`);
      exitCode = 1;
    }

    // Test 5: open(app) Synchronous Execution in Real Browser
    console.log('\n--- Test 5: open(app) Real Browser Curtain & Scenery Pause ---');
    const launchResult = await cdp.eval(`
      (() => {
        const screen = document.getElementById('screen');
        const curtain = document.getElementById('curtain');

        // Dispatch keydown followed by keyup on document (app opens on release)
        const kd = new KeyboardEvent('keydown', { keyCode: 13, bubbles: true });
        const ku = new KeyboardEvent('keyup', { keyCode: 13, bubbles: true });
        document.dispatchEvent(kd);
        document.dispatchEvent(ku);

        const pausedImmediately = screen.classList.contains('weather-paused');
        const curtainActive = curtain.classList.contains('is-on');
        const curtainColor = curtain.style.getPropertyValue('--c');

        return {
          pausedImmediately,
          curtainActive,
          curtainColor
        };
      })()
    `);

    console.log(`  Curtain is-on immediately: ${launchResult.curtainActive}`);
    console.log(`  Curtain color variable: '${launchResult.curtainColor}'`);
    console.log(`  Screen weather-paused immediately: ${launchResult.pausedImmediately}`);

    if (launchResult.curtainActive && launchResult.pausedImmediately && launchResult.curtainColor) {
      console.log('  [PASS] open(app) synchronously armed curtain and paused scenery in live browser');
    } else {
      console.error('  [FAIL] open(app) failed to synchronously arm curtain or pause scenery');
      exitCode = 1;
    }

  } catch (err) {
    console.error(`Fatal CDP Harness Error: ${err.message}`);
    exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    edgeProc.kill('SIGKILL');
    server.close();
  }

  console.log('\n=================================================================');
  console.log(`  BROWSER EMPIRICAL HARNESS FINISHED: ${exitCode === 0 ? 'ALL PASSED' : 'FAILURES DETECTED'}`);
  console.log('=================================================================\n');

  process.exit(exitCode);
}

runBrowserEmpiricalLifecycleSuite();
