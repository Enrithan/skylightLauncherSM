// The landscape behind the home screen: a sky that blends through the day, the sun with its glare,
// the moon in its real phase, stars, aurora, clouds, mountains, pines and a lake. It is painted
// once a minute; the only things that move on their own are a few tiny stars, fireflies, the
// aurora's slow drift, the shimmer on the water, and the occasional bird or shooting star.
window.Scenery = (function () {
  'use strict';

  var CENTRE = { x: 960, y: 540 };
  var HORIZON = 470;
  var SUNRISE = 6.2; // hours; close enough across India
  var SUNSET = 17.8;
  var BLEND_MINUTES = 50; // how long the colours take to cross from one time of day to the next

  // One palette per part of the day, in order; colours blend across each boundary.
  var SKIES = [
    { from: 5, name: 'dawn', top: '#1b1d3f', mid: '#4f4370', low: '#e2a283', floor: '#0b0a15',
      cloudLit: 'rgba(255, 210, 196, 0.30)', cloudShade: 'rgba(96, 72, 120, 0.22)',
      haze: 'rgba(255, 196, 150, 0.42)', glare: '#ffd9b4', rays: 0.55, flare: 0.75, rim: 0.32,
      stars: 0.12, milky: 0, aurora: 0, fireflies: 0, mist: 0.9, godrays: 0.35 },
    { from: 8, name: 'day', top: '#0f2c52', mid: '#2f6797', low: '#9cc6dc', floor: '#06101b',
      cloudLit: 'rgba(255, 255, 255, 0.30)', cloudShade: 'rgba(110, 140, 180, 0.20)',
      haze: 'rgba(255, 244, 220, 0.30)', glare: '#fff6e2', rays: 0.32, flare: 0.5, rim: 0.14,
      stars: 0, milky: 0, aurora: 0, fireflies: 0, mist: 0.25, godrays: 0.15 },
    { from: 16, name: 'golden', top: '#1f1a3a', mid: '#6e3f57', low: '#efa25e', floor: '#0c0809',
      cloudLit: 'rgba(255, 186, 140, 0.34)', cloudShade: 'rgba(100, 56, 84, 0.24)',
      haze: 'rgba(255, 168, 90, 0.50)', glare: '#ffcf93', rays: 0.75, flare: 1, rim: 0.48,
      stars: 0, milky: 0, aurora: 0, fireflies: 0.3, mist: 0.15, godrays: 0.6 },
    { from: 19, name: 'dusk', top: '#0b1131', mid: '#2e2756', low: '#7a4867', floor: '#05060e',
      cloudLit: 'rgba(224, 160, 200, 0.16)', cloudShade: 'rgba(30, 22, 56, 0.24)',
      haze: 'rgba(230, 120, 150, 0.20)', glare: '#ffd2b0', rays: 0, flare: 0, rim: 0.14,
      stars: 0.55, milky: 0.4, aurora: 0.35, fireflies: 1, mist: 0.3, godrays: 0 },
    { from: 21, name: 'night', top: '#03051a', mid: '#0a1334', low: '#1b2a58', floor: '#03040b',
      cloudLit: 'rgba(170, 190, 255, 0.07)', cloudShade: 'rgba(0, 0, 0, 0.12)',
      haze: 'rgba(120, 140, 255, 0.10)', glare: '#dfe6ff', rays: 0, flare: 0, rim: 0.08,
      stars: 1, milky: 1, aurora: 1, fireflies: 0.7, mist: 0.2, godrays: 0 }
  ];

  // Lens ghosts: `f` is how far along the sun-to-centre line each sits (1 = the centre).
  var GHOSTS = [
    { f: 0.28, size: 54, kind: 'disc', rgb: '255, 214, 160', alpha: 0.22 },
    { f: 0.52, size: 22, kind: 'disc', rgb: '160, 230, 255', alpha: 0.3 },
    { f: 0.74, size: 120, kind: 'ring', rgb: '255, 190, 140', alpha: 0.18 },
    { f: 0.98, size: 40, kind: 'hex', rgb: '170, 255, 210', alpha: 0.16 },
    { f: 1.22, size: 170, kind: 'hex', rgb: '190, 170, 255', alpha: 0.09 },
    { f: 1.46, size: 64, kind: 'disc', rgb: '255, 170, 120', alpha: 0.14 },
    { f: 1.75, size: 230, kind: 'ring', rgb: '160, 210, 255', alpha: 0.08 }
  ];

  var MOON_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon',
    'Waning gibbous', 'Last quarter', 'Waning crescent'];

  var root = document.documentElement.style;
  var screen, glare, moon, haze, lake, glitter, glitterLayers, ghosts, birds, meteor, moonShade, column, detail;
  var sky = null;      // the blended palette in use
  var skyKey = '';
  var bodyKind = '';
  var birdTimer = null;
  var meteorTimer = null;
  var visitorsFor = '';

  function byId(id) { return document.getElementById(id); }

  // ---- Colour helpers ------------------------------------------------------------------------

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function hex(c) {
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.max(0, Math.min(255, Math.round(c[i])));
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  function mix(a, b, t) {
    var ca = rgb(a);
    var cb = rgb(b);
    return hex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
  }

  function mixRgba(a, b, t) {
    var pa = a.match(/[\d.]+/g).map(Number);
    var pb = b.match(/[\d.]+/g).map(Number);
    var out = [];
    for (var i = 0; i < 4; i++) out.push(pa[i] + (pb[i] - pa[i]) * t);
    return 'rgba(' + Math.round(out[0]) + ', ' + Math.round(out[1]) + ', ' + Math.round(out[2]) + ', ' + out[3].toFixed(3) + ')';
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function seeded(seed) {
    return function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  }

  // In lean mode elements are placed with left/top instead of a transform, so they are painted
  // into the sky's single image rather than each becoming a layer of its own.
  var lean = false;

  function move(el, x, y) {
    if (lean) {
      el.style.transform = 'none';
      el.style.left = Math.round(x) + 'px';
      if (y !== null) el.style.top = Math.round(y) + 'px';
      return;
    }
    el.style.transform = 'translate3d(' + Math.round(x) + 'px, ' + Math.round(y) + 'px, 0)';
  }

  // ---- Built once ----------------------------------------------------------------------------

  function sprinkleStars() {
    var random = seeded(20251026);
    var dots = [];
    for (var i = 0; i < 130; i++) {
      var x = Math.round(random() * 1920);
      var y = Math.round(random() * 450);
      var alpha = (0.15 + random() * 0.6).toFixed(2);
      var size = random() > 0.9 ? 1 : 0;
      dots.push(x + 'px ' + y + 'px 0 ' + size + 'px rgba(255, 255, 255, ' + alpha + ')');
    }
    byId('stars').style.boxShadow = dots.join(', ');

    var twinkles = byId('twinkles');
    for (var j = 0; j < 10; j++) {
      var star = document.createElement('i');
      star.style.left = Math.round(random() * 1900) + 'px';
      star.style.top = Math.round(20 + random() * 380) + 'px';
      star.style.setProperty('--t', (2.6 + random() * 3).toFixed(1) + 's');
      star.style.animationDelay = (-random() * 5).toFixed(1) + 's';
      twinkles.appendChild(star);
    }

    // Fireflies: a few over the open water right of the tiles, a few along the near shore.
    var fireflies = byId('fireflies');
    for (var k = 0; k < 9; k++) {
      var fly = document.createElement('i');
      var onWater = k < 5;
      fly.style.left = Math.round(onWater ? 1540 + random() * 340 : 130 + random() * 1360) + 'px';
      fly.style.top = Math.round(onWater ? 520 + random() * 130 : 466 + random() * 40) + 'px';
      fly.style.setProperty('--dx', Math.round(-40 + random() * 80) + 'px');
      fly.style.setProperty('--dy', Math.round(-24 + random() * 48) + 'px');
      fly.style.setProperty('--t', (6 + random() * 6).toFixed(1) + 's');
      fly.style.animationDelay = (-random() * 10).toFixed(1) + 's';
      fireflies.appendChild(fly);
    }
  }

  function makeGhosts() {
    var box = byId('flares');
    return GHOSTS.map(function (g) {
      var el = document.createElement('i');
      var c = 'rgba(' + g.rgb + ', ';
      el.style.width = el.style.height = g.size + 'px';
      if (g.kind === 'ring') {
        el.style.background = 'radial-gradient(circle, ' + c + '0) 54%, ' + c + g.alpha + ') 64%, ' + c + '0) 72%)';
      } else if (g.kind === 'hex') {
        el.className = 'hex';
        el.style.background = 'radial-gradient(circle, ' + c + (g.alpha * 0.35) + ') 0%, ' + c + g.alpha + ') 100%)';
      } else {
        el.style.background = 'radial-gradient(circle, ' + c + g.alpha + ') 0%, ' + c + (g.alpha * 0.55) + ') 42%, ' + c + '0) 70%)';
      }
      box.appendChild(el);
      return { el: el, ghost: g };
    });
  }

  function makeGrain() {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      var ctx = canvas.getContext('2d');
      var noise = ctx.createImageData(128, 128);
      for (var i = 0; i < noise.data.length; i += 4) {
        var v = Math.round(Math.random() * 255);
        noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
        noise.data[i + 3] = 255;
      }
      ctx.putImageData(noise, 0, 0);
      byId('grain').style.backgroundImage = 'url(' + canvas.toDataURL('image/png') + ')';
    } catch (e) { /* no canvas; the gradients just stay smooth */ }
  }

  // Two textures of short bright dashes, narrow near the shore and wider toward the viewer, like
  // light breaking on small waves. They crossfade in CSS to shimmer.
  function paintGlitter(colour) {
    var c = rgb(colour).join(', ');
    glitterLayers.forEach(function (layer, n) {
      try {
        var random = seeded(n ? 977 : 131);
        var canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 330;
        var ctx = canvas.getContext('2d');
        for (var i = 0; i < 300; i++) {
          var y = Math.pow(random(), 1.5) * 330;
          var u = Math.max(1e-6, random());
          var gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
          var x = 180 + gauss * (14 + y * 0.24);
          var w = 3 + random() * (6 + y * 0.09);
          ctx.fillStyle = 'rgba(' + c + ', ' + (0.3 + random() * 0.7).toFixed(2) + ')';
          ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w), y < 70 ? 1 : 2);
        }
        layer.style.backgroundImage = 'url(' + canvas.toDataURL('image/png') + ')';
      } catch (e) { /* no canvas: no glitter */ }
    });
  }

  // ---- The palette for this minute ----------------------------------------------------------

  // The palette in force at `hour`, blended with the next one during the minutes before it starts.
  function paletteAt(hour) {
    var i = SKIES.length - 1; // before dawn it is still night
    for (var k = 0; k < SKIES.length; k++) if (hour >= SKIES[k].from) i = k;
    var current = SKIES[i];
    var next = SKIES[(i + 1) % SKIES.length];
    var boundary = next.from > current.from ? next.from : next.from + 24; // night wraps to dawn
    var minutesLeft = (boundary - hour) * 60;
    var t = minutesLeft < BLEND_MINUTES ? 1 - minutesLeft / BLEND_MINUTES : 0;
    if (!t) return current;

    var out = {};
    for (var key in current) {
      var a = current[key];
      var b = next[key];
      if (typeof a === 'number') out[key] = lerp(a, b, t);
      else if (typeof a === 'string' && a.charAt(0) === '#') out[key] = mix(a, b, t);
      else if (typeof a === 'string' && a.indexOf('rgba') === 0) out[key] = mixRgba(a, b, t);
      else out[key] = a;
    }
    out.name = current.name + '>' + next.name;
    return out;
  }

  function paint(s) {
    root.setProperty('--sky-top', s.top);
    root.setProperty('--sky-mid', s.mid);
    root.setProperty('--sky-low', s.low);
    root.setProperty('--floor', s.floor);
    root.setProperty('--cloud-lit', s.cloudLit);
    root.setProperty('--cloud-shade', s.cloudShade);
    root.setProperty('--haze', s.haze);
    root.setProperty('--glare', s.glare);
    root.setProperty('--rays', s.rays.toFixed(3));
    root.setProperty('--rim', s.rim.toFixed(3));
    root.setProperty('--stars', s.stars.toFixed(3));
    root.setProperty('--milky', s.milky.toFixed(3));
    root.setProperty('--aurora', s.aurora.toFixed(3));
    root.setProperty('--fireflies', s.fireflies.toFixed(3));
    root.setProperty('--mist', s.mist.toFixed(3));
    root.setProperty('--godrays', s.godrays.toFixed(3));
    // Mountains fade into the haze with distance; the lake mirrors the horizon, darkened.
    root.setProperty('--ridge-far', mix(s.low, s.mid, 0.45));
    root.setProperty('--ridge-mid', mix(s.mid, s.floor, 0.38));
    root.setProperty('--ridge-near', mix(s.mid, s.floor, 0.78));
    root.setProperty('--pines', mix(s.floor, '#000000', 0.5));
    root.setProperty('--lake-top', mix(s.low, s.floor, 0.55));
    screen.classList.toggle('is-night', s.stars >= 0.5);
    // The animated layers only run when they can be seen.
    screen.classList.toggle('has-aurora', s.aurora > 0.05);
    screen.classList.toggle('has-fireflies', s.fireflies > 0.05);
  }

  // ---- Per minute ----------------------------------------------------------------------------

  // The sun crosses the right of the sky from sunrise to sunset; the moon takes the night shift.
  function placeBodies(now) {
    var hour = now.getHours() + now.getMinutes() / 60;
    var sunUp = hour >= SUNRISE && hour <= SUNSET;
    var night = 24 - SUNSET + SUNRISE;
    var t = sunUp ? (hour - SUNRISE) / (SUNSET - SUNRISE) : ((hour - SUNSET + 24) % 24) / night;
    var x = 1920 * (0.42 + 0.53 * t);
    var y = HORIZON - Math.sin(Math.PI * t) * (HORIZON - 150);

    move(glare, x, y);
    move(moon, x, y);
    move(haze, x, HORIZON);
    move(glitter, x, lean ? null : 0);
    move(column, x, lean ? null : 0);
    glare.classList.toggle('is-up', sunUp);
    moon.classList.toggle('is-up', !sunUp);
    lake.style.setProperty('--refl-x', (x / 19.2).toFixed(1) + '%');
    if (!lean) byId('godrays').style.transform = 'translate3d(' + Math.round(x) + 'px, ' + Math.round(y) + 'px, 0)';

    // Lens ghosts only for the sun, and they dim as it sinks behind the mountains.
    var sinking = Math.max(0, Math.min(1, (HORIZON - y) / 70));
    root.setProperty('--flare', sunUp ? (sky.flare * sinking).toFixed(3) : '0');
    ghosts.forEach(function (g) {
      var gx = x + (CENTRE.x - x) * g.ghost.f;
      var gy = y + (CENTRE.y - y) * g.ghost.f;
      // Lens ghosts always use a transform: left/top would shift their margin box instead.
      g.el.style.transform = 'translate3d(' + Math.round(gx - g.ghost.size / 2) + 'px, ' + Math.round(gy - g.ghost.size / 2) + 'px, 0)';
    });

    // The path of light on the water takes the colour of whichever light is up.
    var kind = sunUp ? 'sun:' + sky.glare : 'moon';
    if (kind !== bodyKind) {
      bodyKind = kind;
      paintGlitter(sunUp ? sky.glare : '#dfe6ff');
      lake.style.setProperty('--lake-glow', sunUp ? 'rgba(' + rgb(sky.glare).join(', ') + ', 0.38)' : 'rgba(220, 228, 255, 0.16)');
      column.style.setProperty('--column', sunUp ? 'rgba(' + rgb(sky.glare).join(', ') + ', 0.22)' : 'rgba(220, 228, 255, 0.14)');
    }
    glitter.classList.toggle('is-on', sunUp ? y < HORIZON - 10 : true);
    column.classList.toggle('is-on', sunUp ? y < HORIZON - 10 : true);
    if (!sunUp) shadeMoon(now);
    writeDetail(now, sunUp);
  }

  function moonPhase(now) {
    var synodicDays = 29.530588853;
    var knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
    var age = (((now.getTime() - knownNewMoon) / 86400000) % synodicDays + synodicDays) % synodicDays;
    return age / synodicDays; // 0 new, 0.5 full
  }

  function shadeMoon(now) {
    var phase = moonPhase(now);
    var lit = (1 - Math.cos(2 * Math.PI * phase)) / 2;
    var offset = Math.round(lit * 1.25 * 100) * (phase < 0.5 ? -1 : 1);
    moonShade.style.transform = 'translate3d(' + offset + 'px, 0, 0)';
  }

  function clock(hours) {
    var h = Math.floor(hours);
    var m = Math.round((hours - h) * 60);
    return (h % 12 || 12) + ':' + (m < 10 ? '0' + m : m) + (h < 12 ? ' am' : ' pm');
  }

  // The quiet line under the date: what the sky is doing.
  function writeDetail(now, sunUp) {
    var name = MOON_NAMES[Math.round(moonPhase(now) * 8) % 8];
    detail.textContent = sunUp ? 'Sunset ' + clock(SUNSET) + '  ·  ' + name
      : name + '  ·  Sunrise ' + clock(SUNRISE);
  }

  // ---- Visitors: birds by day, shooting stars by night ---------------------------------------

  function scheduleVisitors(kind) {
    if (kind === visitorsFor) return;
    visitorsFor = kind;
    // `?visitors` (desktop preview only) sends them straight away so they can be checked.
    var soon = /[?&]visitors\b/.test(location.search);
    clearTimeout(birdTimer);
    clearTimeout(meteorTimer);
    if (kind === 'day') birdTimer = setTimeout(sendBirds, soon ? 300 : 20000 + Math.random() * 60000);
    if (kind === 'night') meteorTimer = setTimeout(sendMeteor, soon ? 300 : 15000 + Math.random() * 45000);
  }

  function sendBirds() {
    if (!document.hidden) {
      var leftToRight = Math.random() < 0.6;
      var y0 = 150 + Math.random() * 170;
      birds.style.setProperty('--fly-x0', (leftToRight ? -180 : 2060) + 'px');
      birds.style.setProperty('--fly-x1', (leftToRight ? 2060 : -180) + 'px');
      birds.style.setProperty('--fly-y0', Math.round(y0) + 'px');
      birds.style.setProperty('--fly-y1', Math.round(y0 - 40 + Math.random() * 80) + 'px');
      birds.style.setProperty('--fly-s', (0.7 + Math.random() * 0.5).toFixed(2));
      birds.style.setProperty('--fly-time', Math.round(30 + Math.random() * 14) + 's');
      birds.classList.remove('is-flying');
      void birds.offsetWidth;
      birds.classList.add('is-flying');
    }
    birdTimer = setTimeout(sendBirds, 150000 + Math.random() * 150000);
  }

  function sendMeteor() {
    if (!document.hidden) {
      meteor.style.setProperty('--m-x', Math.round(250 + Math.random() * 1300) + 'px');
      meteor.style.setProperty('--m-y', Math.round(50 + Math.random() * 200) + 'px');
      meteor.style.setProperty('--m-r', Math.round(18 + Math.random() * 18) + 'deg');
      meteor.classList.remove('is-falling');
      void meteor.offsetWidth;
      meteor.classList.add('is-falling');
    }
    meteorTimer = setTimeout(sendMeteor, 50000 + Math.random() * 70000);
  }

  // ---- Public --------------------------------------------------------------------------------

  function init(options) {
    lean = !!(options && options.lean);
    screen = byId('screen');
    if (lean) screen.classList.add('lean');
    glare = byId('glare');
    moon = byId('moon');
    moonShade = byId('moonShade');
    haze = byId('haze');
    lake = byId('lake');
    glitter = byId('glitter');
    glitterLayers = [byId('glitterA'), byId('glitterB')];
    column = byId('column');
    birds = byId('birds');
    meteor = byId('meteor');
    detail = byId('detail');
    ghosts = makeGhosts();
    sprinkleStars();
    makeGrain();
  }

  var live = false;

  function update(now) {
    if (!live) {
      live = true;
      // The first placement is instant; from then on the sun and moon glide between positions
      // (not in lean mode, where every move is a plain repaint).
      if (!lean) setTimeout(function () { screen.classList.add('is-live'); }, 200);
    }
    var next = paletteAt(now.getHours() + now.getMinutes() / 60);
    var key = next.name + ':' + (next.top + next.low + next.stars.toFixed(2));
    if (key !== skyKey) {
      skyKey = key;
      sky = next;
      bodyKind = '';
      paint(sky);
    }
    scheduleVisitors(sky.stars >= 0.5 ? 'night' : (sky.rays > 0 || sky.name.indexOf('day') >= 0 ? 'day' : 'dusk'));
    placeBodies(now);
  }

  return { init: init, update: update };
})();
