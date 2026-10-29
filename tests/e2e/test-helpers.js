/**
 * E2E Test Suite Shared Helpers for Skylight Tizen
 * Provides lightweight DOM & CSS parsing, VM sandboxing, assertion harness, and test runner.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const SKYLIGHT_DIR = path.join(PROJECT_ROOT, 'skylight');
const INDEX_HTML_PATH = path.join(SKYLIGHT_DIR, 'index.html');
const APP_CSS_PATH = path.join(SKYLIGHT_DIR, 'css', 'app.css');
const SCENERY_JS_PATH = path.join(SKYLIGHT_DIR, 'js', 'scenery.js');
const APP_JS_PATH = path.join(SKYLIGHT_DIR, 'js', 'app.js');
const MOCK_TIZEN_JS_PATH = path.join(SKYLIGHT_DIR, 'js', 'mock-tizen.js');

// ---- Minimal In-Memory DOM Implementation ------------------------------------

class DOMTokenList {
  constructor(element) {
    this._element = element;
    this._tokens = new Set();
    const cls = element.attributes.class || '';
    if (cls) {
      cls.trim().split(/\s+/).forEach(t => t && this._tokens.add(t));
    }
  }

  add(...tokens) {
    for (const t of tokens) {
      if (t) this._tokens.add(t);
    }
    this._sync();
  }

  remove(...tokens) {
    for (const t of tokens) {
      this._tokens.delete(t);
    }
    this._sync();
  }

  toggle(token, force) {
    let result;
    if (force !== undefined) {
      result = !!force;
      if (result) this._tokens.add(token);
      else this._tokens.delete(token);
    } else {
      if (this._tokens.has(token)) {
        this._tokens.delete(token);
        result = false;
      } else {
        this._tokens.add(token);
        result = true;
      }
    }
    this._sync();
    return result;
  }

  contains(token) {
    return this._tokens.has(token);
  }

  _sync() {
    this._element.attributes.class = Array.from(this._tokens).join(' ');
  }

  toString() {
    return Array.from(this._tokens).join(' ');
  }
}

class CSSStyleDeclaration {
  constructor(element) {
    this._element = element;
    this._props = new Map();
  }

  setProperty(name, value) {
    this._props.set(name, String(value));
  }

  getPropertyValue(name) {
    return this._props.get(name) || '';
  }

  removeProperty(name) {
    const val = this._props.get(name);
    this._props.delete(name);
    return val || '';
  }

  get transform() { return this.getPropertyValue('transform'); }
  set transform(v) { this.setProperty('transform', v); }

  get left() { return this.getPropertyValue('left'); }
  set left(v) { this.setProperty('left', v); }

  get top() { return this.getPropertyValue('top'); }
  set top(v) { this.setProperty('top', v); }

  get width() { return this.getPropertyValue('width'); }
  set width(v) { this.setProperty('width', v); }

  get height() { return this.getPropertyValue('height'); }
  set height(v) { this.setProperty('height', v); }

  get opacity() { return this.getPropertyValue('opacity'); }
  set opacity(v) { this.setProperty('opacity', v); }

  get background() { return this.getPropertyValue('background'); }
  set background(v) { this.setProperty('background', v); }

  get backgroundImage() { return this.getPropertyValue('background-image'); }
  set backgroundImage(v) { this.setProperty('background-image', v); }

  get boxShadow() { return this.getPropertyValue('box-shadow'); }
  set boxShadow(v) { this.setProperty('box-shadow', v); }

  get animationDelay() { return this.getPropertyValue('animation-delay'); }
  set animationDelay(v) { this.setProperty('animation-delay', v); }
}

class Element {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = Object.assign({}, attributes);
    this.children = [];
    this.parentNode = null;
    this._textContent = '';
    this.classList = new DOMTokenList(this);
    this.style = new CSSStyleDeclaration(this);
    this._listeners = new Map();
  }

  get id() { return this.attributes.id || ''; }
  set id(val) { this.attributes.id = val; }

  get className() { return this.attributes.class || ''; }
  set className(val) {
    this.attributes.class = val;
    this.classList = new DOMTokenList(this);
  }

  get textContent() { return this._textContent; }
  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
  }

  getAttribute(name) {
    return this.attributes[name] !== undefined ? this.attributes[name] : null;
  }

  setAttribute(name, val) {
    this.attributes[name] = String(val);
    if (name === 'class') {
      this.classList = new DOMTokenList(this);
    }
  }

  removeAttribute(name) {
    delete this.attributes[name];
    if (name === 'class') {
      this.classList = new DOMTokenList(this);
    }
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  appendChild(child) {
    if (!child) return null;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.parentNode = null;
      this.children.splice(idx, 1);
    }
    return child;
  }

  addEventListener(type, listener) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, []);
    }
    this._listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this._listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    event.target = this;
    const list = this._listeners.get(event.type) || [];
    for (const l of list) {
      l.call(this, event);
    }
    return true;
  }

  getElementById(id) {
    if (this.id === id) return this;
    for (const child of this.children) {
      const found = child.getElementById(id);
      if (found) return found;
    }
    return null;
  }

  getElementsByClassName(cls) {
    const res = [];
    if (this.classList.contains(cls)) res.push(this);
    for (const child of this.children) {
      res.push(...child.getElementsByClassName(cls));
    }
    return res;
  }

  getElementsByTagName(tag) {
    const res = [];
    if (this.tagName === tag.toUpperCase()) res.push(this);
    for (const child of this.children) {
      res.push(...child.getElementsByTagName(tag));
    }
    return res;
  }

  querySelector(selector) {
    return this._matchSelector(selector, true);
  }

  querySelectorAll(selector) {
    const results = [];
    this._matchSelector(selector, false, results);
    return results;
  }

  _matchSelector(selector, firstOnly, results = []) {
    // Basic single-part selector matching: #id, .class, tag, [attr=val]
    const s = selector.trim();
    const matchesSelf = this._matchesSingle(s);
    if (matchesSelf) {
      if (firstOnly) return this;
      results.push(this);
    }

    for (const child of this.children) {
      const res = child._matchSelector(selector, firstOnly, results);
      if (firstOnly && res) return res;
    }
    return firstOnly ? null : results;
  }

  _matchesSingle(s) {
    if (s.startsWith('#')) {
      return this.id === s.slice(1);
    }
    if (s.startsWith('.')) {
      const parts = s.split('.').filter(Boolean);
      return parts.every(p => this.classList.contains(p));
    }
    if (s.startsWith('[') && s.endsWith(']')) {
      const m = s.slice(1, -1).match(/([a-zA-Z0-9_-]+)(?:=["']?([^"']*)["']?)?/);
      if (!m) return false;
      const attr = m[1];
      const val = m[2];
      if (val === undefined) return this.hasAttribute(attr);
      return this.getAttribute(attr) === val;
    }
    return this.tagName.toLowerCase() === s.toLowerCase();
  }
}

// ---- Lightweight HTML Parser -------------------------------------------------

function parseHTML(htmlString) {
  const root = new Element('html');
  const stack = [root];

  // Tokenize tags
  const tagRegex = /<!--[\s\S]*?-->|<(\/)?([a-zA-Z0-9:-]+)((?:\s+[^=>\s]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let match;

  while ((match = tagRegex.exec(htmlString)) !== null) {
    const [full, isClose, tagName, attrStr, isSelfClose, text] = match;
    if (full.startsWith('<!--')) {
      continue; // skip comments
    }

    if (text) {
      const trimmed = text.trim();
      if (trimmed && stack.length > 0) {
        stack[stack.length - 1]._textContent += (stack[stack.length - 1]._textContent ? ' ' : '') + trimmed;
      }
      continue;
    }

    if (isClose) {
      const upper = tagName.toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === upper) {
          stack.splice(i);
          break;
        }
      }
      continue;
    }

    // Opening tag
    const attrs = {};
    if (attrStr) {
      const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let am;
      while ((am = attrRegex.exec(attrStr)) !== null) {
        const key = am[1];
        const val = am[2] !== undefined ? am[2] : am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : '';
        attrs[key] = val;
      }
    }

    const el = new Element(tagName, attrs);
    const parent = stack[stack.length - 1];
    parent.appendChild(el);

    const voidTags = ['META', 'LINK', 'IMG', 'BR', 'HR', 'INPUT', 'USE', 'PATH'];
    if (!isSelfClose && !voidTags.includes(el.tagName)) {
      stack.push(el);
    }
  }

  return root;
}

// ---- CSS Parser -------------------------------------------------------------

class CSSRuleBook {
  constructor(cssContent) {
    this.raw = cssContent;
    this.rules = new Map(); // selector -> { [prop]: value }
    this.keyframes = new Map(); // name -> keyframe body
    this._parse();
  }

  _parse() {
    // Strip comments
    const stripped = this.raw.replace(/\/\*[\s\S]*?\*\//g, '');

    // Extract @keyframes
    const kfRegex = /@keyframes\s+([a-zA-Z0-9_-]+)\s*\{([\s\S]*?\}\s*)\}/g;
    let km;
    while ((km = kfRegex.exec(stripped)) !== null) {
      this.keyframes.set(km[1], km[2]);
    }

    // Extract regular blocks
    const blockRegex = /([^{}]+)\{([^}]+)\}/g;
    let bm;
    while ((bm = blockRegex.exec(stripped)) !== null) {
      const selStr = bm[1].trim();
      const body = bm[2].trim();
      if (selStr.startsWith('@')) continue; // skip at-rules here

      const props = {};
      body.split(';').forEach(decl => {
        const colon = decl.indexOf(':');
        if (colon !== -1) {
          const prop = decl.slice(0, colon).trim();
          const val = decl.slice(colon + 1).trim();
          if (prop) props[prop] = val;
        }
      });

      // Split comma-separated selectors
      selStr.split(',').forEach(s => {
        const clean = s.trim();
        if (clean) {
          const existing = this.rules.get(clean) || {};
          this.rules.set(clean, Object.assign(existing, props));
        }
      });
    }
  }

  getProperties(selector) {
    return this.rules.get(selector.trim()) || null;
  }

  getProperty(selector, prop) {
    const props = this.getProperties(selector);
    return props ? props[prop] : null;
  }

  hasSelector(selector) {
    return this.rules.has(selector.trim());
  }

  hasKeyframes(name) {
    return this.keyframes.has(name);
  }

  hasPropertyAnywhere(propName) {
    for (const [_, props] of this.rules) {
      if (props[propName] !== undefined) return true;
    }
    return false;
  }

  hasForbiddenProperty(propName, forbiddenRegex) {
    for (const [_, props] of this.rules) {
      for (const [k, v] of Object.entries(props)) {
        if (k === propName || k.includes(propName)) {
          if (!forbiddenRegex || forbiddenRegex.test(v)) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

// ---- VM Sandbox Builder ------------------------------------------------------

function createSandbox(htmlSource, options = {}) {
  const root = parseHTML(htmlSource || fs.readFileSync(INDEX_HTML_PATH, 'utf8'));
  const documentElement = root.getElementsByTagName('html')[0] || root;
  const body = root.getElementsByTagName('body')[0] || root;
  const head = root.getElementsByTagName('head')[0] || root;

  const storage = new Map();
  const localStorage = {
    getItem: key => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: key => storage.delete(key),
    clear: () => storage.clear()
  };

  const document = {
    documentElement: documentElement,
    body: body,
    head: head,
    hidden: !!options.hidden,
    getElementById: id => root.getElementById(id),
    getElementsByClassName: cls => root.getElementsByClassName(cls),
    getElementsByTagName: tag => root.getElementsByTagName(tag),
    querySelector: sel => root.querySelector(sel),
    querySelectorAll: sel => root.querySelectorAll(sel),
    createElement: tag => {
      const el = new Element(tag);
      if (tag.toLowerCase() === 'canvas') {
        el.getContext = () => ({
          createImageData: () => ({ data: new Uint8ClampedArray(128 * 128 * 4) }),
          putImageData: () => {},
          fillRect: () => {},
          fillStyle: ''
        });
        el.toDataURL = () => 'data:image/png;base64,mock';
      }
      return el;
    },
    addEventListener: (type, fn) => documentElement.addEventListener(type, fn),
    removeEventListener: (type, fn) => documentElement.removeEventListener(type, fn),
    dispatchEvent: evt => documentElement.dispatchEvent(evt)
  };

  const location = {
    search: options.search || '',
    pathname: '/index.html',
    href: 'http://localhost/index.html' + (options.search || '')
  };

  const timers = new Set();
  const intervals = new Set();

  const sandbox = {
    window: null,
    document: document,
    location: location,
    localStorage: localStorage,
    console: console,
    Math: Math,
    Date: Date,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms);
      timers.add(id);
      return id;
    },
    clearTimeout: id => {
      clearTimeout(id);
      timers.delete(id);
    },
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms);
      intervals.add(id);
      return id;
    },
    clearInterval: id => {
      clearInterval(id);
      intervals.delete(id);
    },
    KeyboardEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.bubbles = !!init.bubbles;
        this.keyCode = init.keyCode || 0;
      }
    },
    URLSearchParams: URLSearchParams,
    SKYLIGHT_CATALOG: options.catalog || [
      { id: 'org.tizen.netflix-app', name: 'Netflix', icon: 'icons/netflix.png' },
      { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', icon: 'icons/youtube.png' },
      { id: 'org.tizen.primevideo', name: 'Prime Video', icon: 'icons/primevideo.png' }
    ],
    tizen: options.tizen || {
      application: {
        getCurrentApplication: () => ({ appInfo: { version: '2.4.0' } }),
        launch: (id, onSucc, onErr) => {
          if (options.launchFail) {
            if (onErr) onErr(new Error('Launch failed: ' + id));
          } else {
            if (onSucc) onSucc();
          }
        },
        getAppsContext: onSucc => onSucc([]),
        kill: () => {}
      }
    },
    dispose: () => {
      timers.forEach(t => clearTimeout(t));
      intervals.forEach(i => clearInterval(i));
      timers.clear();
      intervals.clear();
    }
  };

  sandbox.window = sandbox;
  return vm.createContext(sandbox);
}

// ---- Lightweight Test Runner -------------------------------------------------

class TestRunner {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.tests = [];
    this.currentFeature = '';
  }

  feature(name, fn) {
    this.currentFeature = name;
    fn();
  }

  test(name, fn) {
    this.tests.push({
      feature: this.currentFeature,
      name: name,
      fn: fn
    });
  }

  async run() {
    console.log(`\n======================================================`);
    console.log(`  E2E Test Suite: ${this.suiteName}`);
    console.log(`======================================================\n`);

    let passed = 0;
    let failed = 0;
    const errors = [];
    const featureStats = new Map();

    const startTime = Date.now();

    for (const t of this.tests) {
      const fName = t.feature || 'General';
      if (!featureStats.has(fName)) {
        featureStats.set(fName, { passed: 0, failed: 0, total: 0 });
      }
      const fStat = featureStats.get(fName);
      fStat.total++;

      try {
        await t.fn();
        passed++;
        fStat.passed++;
        console.log(`  [PASS] [${fName}] ${t.name}`);
      } catch (err) {
        failed++;
        fStat.failed++;
        console.log(`  [FAIL] [${fName}] ${t.name}`);
        console.log(`         Error: ${err.message}`);
        errors.push({ feature: fName, test: t.name, error: err });
      }
    }

    const elapsed = Date.now() - startTime;

    console.log(`\n------------------------------------------------------`);
    console.log(`  Summary by Feature:`);
    console.log(`------------------------------------------------------`);
    for (const [fName, stat] of featureStats.entries()) {
      const pct = Math.round((stat.passed / stat.total) * 100);
      const mark = stat.failed === 0 ? '✓' : '✗';
      console.log(`  ${mark} ${fName.padEnd(35)} : ${stat.passed}/${stat.total} passed (${pct}%)`);
    }

    console.log(`------------------------------------------------------`);
    console.log(`  Total: ${this.tests.length} | Passed: ${passed} | Failed: ${failed} | Time: ${elapsed}ms`);
    console.log(`======================================================\n`);

    return {
      suite: this.suiteName,
      total: this.tests.length,
      passed: passed,
      failed: failed,
      elapsedMs: elapsed,
      errors: errors,
      featureStats: Object.fromEntries(featureStats)
    };
  }
}

module.exports = {
  PROJECT_ROOT,
  SKYLIGHT_DIR,
  INDEX_HTML_PATH,
  APP_CSS_PATH,
  SCENERY_JS_PATH,
  APP_JS_PATH,
  MOCK_TIZEN_JS_PATH,
  parseHTML,
  CSSRuleBook,
  createSandbox,
  TestRunner
};
