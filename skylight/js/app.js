// Skylight: an ad-free home screen for the TV. Shows your apps on two rows and opens them with the
// remote. Holding OK on an app offers to move it or hide it. The landscape behind is scenery.js.
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, ESCAPE: 27, BACK: 10009 };
  var HOLD_MS = 650;
  var EDGE = 112;
  var VIEW_WIDTH = 1920 - 2 * EDGE;
  var HIDDEN_TILE = '__hidden__';
  var SAMSUNG_TILE = '__samsung__';
  var HELPER_ID = 'skylightTV.SkylightWatch'; // the background helper in service/index.js
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  var SPARE_COLOURS = ['#3D5BD9', '#B83E62', '#1F8A70', '#B8701F', '#6A44C9', '#1F7FA8'];

  var catalog = window.SKYLIGHT_CATALOG;
  var screen = byId('screen');
  var captionTitle = byId('captionTitle');
  var captionNote = byId('captionNote');
  var hint = byId('hint');
  var curtain = byId('curtain');
  var menuEl = byId('menu');
  var glows = [byId('glowA'), byId('glowB')];

  var rows = [
    { key: 'favourites', el: byId('favourites'), items: [], shift: 0 },
    { key: 'all', el: byId('all'), items: [], shift: 0 }
  ];
  var focus = { row: 0, col: 0 };
  var moving = null; // { id, snapshot } while an app is being moved
  var menu = null;   // { app, index } while the hold-OK menu is open
  var enterIsDown = false;
  var holdFired = false;
  var holdTimer = null;
  var launching = false;
  var revealPending = false;
  var glowIndex = 0;
  var glowColour = '';
  var tickTimer = null;
  var installed = null;
  var installedKey = '';
  var hintSeen = load('hintSeen') === '1';

  function byId(id) { return document.getElementById(id); }

  // ---- Diagnostics: press Up three times on the top row to see what Skylight has noticed ------

  var diary = [];
  var version = 'preview';
  try { version = tizen.application.getCurrentApplication().appInfo.version; } catch (e) { /* desktop preview */ }
  // Each new version starts a fresh diary, so old entries can't crowd out the ones that matter.
  if (load('diaryVersion') === version) {
    try { diary = JSON.parse(load('diary') || '[]'); } catch (e) { diary = []; }
  }
  save('diaryVersion', version);
  var upPresses = 0;

  function note(text) {
    var t = new Date();
    var two = function (n) { return (n < 10 ? '0' : '') + n; };
    diary.push(two(t.getHours()) + ':' + two(t.getMinutes()) + ':' + two(t.getSeconds()) + '  ' + String(text).slice(0, 160));
    if (diary.length > 30) diary.shift();
    save('diary', JSON.stringify(diary));
  }

  // Shows this page's notes and the helper's log together, newest first.
  function showDiary() {
    var panel = byId('diary');
    panel.textContent = 'What Skylight noticed, newest first (press Up three times to close)\n\n' +
      diary.slice(-16).reverse().join('\n');
    helperGet('log', function (text) {
      if (panel.hidden) return;
      var helper = 'helper: not reachable on its port';
      try {
        var info = JSON.parse(text);
        helper = (info.watching ? 'helper: watching ' + info.watching : 'helper: standing guard') +
          (info.paused ? ' (leaving Samsung’s screen alone for now)' : '') + ', up since ' + info.since + '\n' +
          info.lines.slice(-14).reverse().join('\n');
      } catch (e) { /* no answer */ }
      panel.textContent += '\n\n' + helper;
    });
  }

  function toggleDiary() {
    var panel = byId('diary');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) showDiary();
  }

  function load(key) {
    try { return localStorage.getItem('skylight.' + key); } catch (e) { return null; }
  }

  function save(key, value) {
    try { localStorage.setItem('skylight.' + key, value); } catch (e) { /* storage unavailable */ }
  }

  function list(key) {
    return (load(key) || '').split(',').filter(Boolean);
  }

  // ---- Colour helpers ------------------------------------------------------------------------

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, alpha) {
    var c = rgb(hex);
    return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + alpha + ')';
  }

  function mix(hex, withHex, amount) {
    var a = rgb(hex);
    var b = rgb(withHex);
    var out = '#';
    for (var i = 0; i < 3; i++) {
      var v = Math.round(a[i] + (b[i] - a[i]) * amount);
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  function spareColour(id) {
    var hash = 0;
    for (var i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
    return SPARE_COLOURS[Math.abs(hash) % SPARE_COLOURS.length];
  }

  // ---- Apps ----------------------------------------------------------------------------------

  function readInstalled(done) {
    try {
      tizen.application.getAppsInfo(function (apps) { done(apps); }, function () { done(null); });
    } catch (e) {
      done(null);
    }
  }

  // "Spotify - Music and Podcasts" reads better on a tile as "Spotify".
  function tidyName(name) {
    return String(name).split(/\s+[-–|:]\s+|,\s/)[0];
  }

  function describe(id, tvName, tvIcon) {
    var known = catalog.apps[id] || {};
    var tile = known.tile || spareColour(id);
    return {
      id: id,
      name: known.name || tidyName(tvName || id),
      note: known.note || '',
      icon: known.icon || '',
      dial: known.dial || '',
      engine: known.engine || '',
      tvIcon: tvIcon || '',
      tile: tile,
      ink: known.ink || '#FFFFFF',
      glow: known.glow || tile
    };
  }

  // Known apps, plus anything installed from the store or sideloaded (those have a 10-character
  // package id). Samsung's own system apps that this file doesn't name are left out.
  function isWanted(app, hidden) {
    var known = catalog.apps[app.id];
    if (hidden[app.id]) return false;
    if (known && known.always) return true;
    if (app.show === false) return false;
    if (/service$/i.test(app.id)) return false; // background helpers, not apps to open
    return !!known || /^[A-Za-z0-9]{10}\./.test(app.id);
  }

  function buildRows() {
    var hidden = {};
    catalog.hidden.concat(list('hidden')).forEach(function (id) { hidden[id] = true; });

    // Without the TV's list (desktop preview, or a failed read) the apps this file knows are shown.
    var source = installed || Object.keys(catalog.apps).map(function (id) { return { id: id, name: '' }; });
    var apps = source
      .filter(function (a) { return isWanted(a, hidden); })
      .map(function (a) { return describe(a.id, a.name, a.iconPath); });

    var savedFavourites = list('order.favourites');
    var savedAll = list('order.all');
    var favourites = [];
    var rest = [];
    apps.forEach(function (app) {
      var isFavourite = savedFavourites.indexOf(app.id) >= 0 ||
        (savedAll.indexOf(app.id) < 0 && catalog.favourites.indexOf(app.id) >= 0);
      (isFavourite ? favourites : rest).push(app);
    });

    rows[0].items = favourites.sort(byRank(savedFavourites, catalog.favourites));
    rows[1].items = rest.sort(byRank(savedAll, catalog.first));

    var strangers = apps.filter(function (app) { return !catalog.apps[app.id]; });
    if (strangers.length) note('also showing: ' + strangers.map(function (a) { return a.id + ' (' + a.name + ')'; }).join(', '));

    rows[1].items.push({
      id: SAMSUNG_TILE,
      name: 'Samsung',
      note: 'Samsung’s own screen, for the app store and the rest',
      icon: 'icons/samsung.svg',
      tvIcon: '',
      tile: '#1E3F8F',
      ink: '#FFFFFF',
      glow: '#4C7DFF',
      special: true
    });

    var userHidden = list('hidden').length;
    if (userHidden) {
      rows[1].items.push({
        id: HIDDEN_TILE,
        name: 'Hidden apps',
        note: 'Press OK to bring back the ' + (userHidden === 1 ? 'app' : userHidden + ' apps') + ' you hid',
        icon: 'icons/hidden.svg',
        tvIcon: '',
        tile: '#2A3042',
        ink: '#FFFFFF',
        glow: '#8A94B0',
        special: true
      });
    }
  }

  // Saved order first, then the catalogue's order, then everything else A-Z.
  function byRank(saved, first) {
    function rank(app) {
      var i = saved.indexOf(app.id);
      if (i >= 0) return [0, i];
      i = first.indexOf(app.id);
      if (i >= 0) return [1, i];
      return [2, 0];
    }
    return function (a, b) {
      var ra = rank(a);
      var rb = rank(b);
      if (ra[0] !== rb[0]) return ra[0] - rb[0];
      if (ra[1] !== rb[1]) return ra[1] - rb[1];
      return a.name.localeCompare(b.name);
    };
  }

  // ---- Rendering -----------------------------------------------------------------------------

  function render() {
    var focusedId = currentApp() ? currentApp().id : '';

    rows.forEach(function (row) {
      row.el.innerHTML = '';
      row.items.forEach(function (app, i) { row.el.appendChild(makeTile(app, i)); });
      row.shift = 0;
    });

    if (!rows[0].items.length && !rows[1].items.length) {
      captionTitle.textContent = 'No apps to show yet';
      captionNote.textContent = 'Apps you install from Samsung’s Apps tab appear here.';
      hint.classList.add('is-hidden');
      return;
    }

    restoreFocus(focusedId);
    paintFocus(true);
    rows.forEach(function (row, i) { if (i !== focus.row) scrollRow(i); });
  }

  // A tile is the app's logo, edge to edge. The caption below the row names the selected app.
  function makeTile(app, index) {
    var el = document.createElement('div');
    el.className = 'tile';
    el.setAttribute('aria-label', app.name);
    el.style.setProperty('--tile-a', mix(app.tile, '#ffffff', 0.14));
    el.style.setProperty('--tile-b', app.tile);
    el.style.setProperty('--tile-c', mix(app.tile, '#000000', 0.4));
    el.style.setProperty('--ink', app.ink);
    el.style.setProperty('--shadow', rgba(app.glow, 0.5));
    el.style.setProperty('--i', String(index));

    var src = app.icon || (app.tvIcon ? (/^[a-z]+:/i.test(app.tvIcon) ? app.tvIcon : 'file://' + app.tvIcon) : '');
    if (src) {
      var img = new Image();
      img.className = 'tile-img';
      img.alt = '';
      // If the TV won't hand over an icon, fall back to the app's initial and name.
      img.onerror = function () { el.removeChild(img); addInitial(el, app); };
      img.src = src;
      el.appendChild(img);
    } else {
      addInitial(el, app);
    }

    app.el = el;
    return el;
  }

  function addInitial(el, app) {
    var initial = document.createElement('span');
    initial.className = 'tile-initial';
    initial.textContent = app.name.charAt(0);
    el.appendChild(initial);

    var name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = app.name;
    el.appendChild(name);
  }

  function restoreFocus(id) {
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].items.length; c++) {
        if (rows[r].items[c].id === id) { focus.row = r; focus.col = c; return; }
      }
    }
    if (!rows[focus.row].items.length) focus.row = rows[0].items.length ? 0 : 1;
    focus.col = Math.max(0, Math.min(focus.col, rows[focus.row].items.length - 1));
  }

  function currentApp() {
    var row = rows[focus.row];
    return row ? row.items[focus.col] : null;
  }

  function paintFocus(instant) {
    rows.forEach(function (row, r) {
      row.items.forEach(function (app, c) {
        var here = r === focus.row && c === focus.col;
        app.el.classList.toggle('is-focused', here && !moving);
        app.el.classList.toggle('is-moving', here && !!moving);
      });
    });

    var app = currentApp();
    if (!app) return;
    scrollRow(focus.row);
    moveGlow(app, instant);
    showCaption(app);
  }

  function showCaption(app) {
    captionNote.classList.remove('is-error');
    if (moving) {
      captionTitle.textContent = 'Moving ' + app.name;
      captionNote.textContent = 'Use the arrows to place it, then press OK';
      hint.classList.add('is-hidden');
      return;
    }
    if (captionTitle.textContent !== app.name) {
      captionTitle.textContent = app.name;
      restart(captionTitle, 'is-fresh');
    }
    captionNote.textContent = app.note || lastOpened(app.id);
    hint.classList.toggle('is-hidden', hintSeen || !!app.special);
  }

  // Re-runs a one-shot CSS animation by taking the class off and putting it back.
  function restart(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  function lastOpened(id) {
    var at = parseInt(load('opened.' + id) || '0', 10);
    if (!at) return '';
    var minutes = Math.round((Date.now() - at) / 60000);
    if (minutes < 1) return 'Opened just now';
    if (minutes < 60) return 'Opened ' + minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(minutes / 60);
    if (hours < 24) return 'Opened ' + hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    return days === 1 ? 'Opened yesterday' : 'Opened ' + days + ' days ago';
  }

  // Slides a row sideways so the selected app stays on screen. Tiles past the edge just peek in,
  // which shows there is more to the right.
  function scrollRow(index) {
    var row = rows[index];
    var app = index === focus.row ? row.items[focus.col] : null;
    if (app) {
      var left = app.el.offsetLeft;
      var right = left + app.el.offsetWidth;
      if (right - row.shift > VIEW_WIDTH) row.shift = right - VIEW_WIDTH + 30;
      if (left - row.shift < 0) row.shift = Math.max(0, left - 30);
    }
    row.el.style.transform = 'translate3d(' + (-row.shift) + 'px, 0, 0)';
  }

  // Centre of a tile in screen coordinates (offsets ignore the row's scroll transform).
  function centreOf(el) {
    var x = el.offsetWidth / 2;
    var y = el.offsetHeight / 2;
    for (var node = el; node && node !== screen; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    rows.forEach(function (row) { if (el.parentNode === row.el) x -= row.shift; });
    return { x: x, y: y };
  }

  function moveGlow(app, instant) {
    var at = centreOf(app.el);
    // Centred a little below the tile, so the light falls on the water rather than into the sky.
    var transform = 'translate3d(' + Math.round(at.x) + 'px, ' + Math.round(at.y + 56) + 'px, 0)';
    var level = focus.row === 0 ? 'is-on' : 'is-dim';

    if (app.glow !== glowColour) {
      var outgoing = glows[glowIndex];
      glowIndex = 1 - glowIndex;
      var incoming = glows[glowIndex];
      // Start the new colour where the old light is, so it glides over rather than flying in.
      incoming.style.transition = 'none';
      incoming.style.transform = outgoing.style.transform || transform;
      incoming.style.setProperty('--c', app.glow);
      incoming.style.setProperty('--c0', rgba(app.glow, 0));
      void incoming.offsetWidth;
      incoming.style.transition = '';
      outgoing.classList.remove('is-on', 'is-dim');
      glowColour = app.glow;
    }

    glows.forEach(function (layer) {
      if (instant) layer.style.transition = 'none';
      layer.style.transform = transform;
      if (instant) { void layer.offsetWidth; layer.style.transition = ''; }
    });
    var lit = glows[glowIndex];
    lit.classList.remove(level === 'is-on' ? 'is-dim' : 'is-on');
    lit.classList.add(level);
  }

  // ---- Remote --------------------------------------------------------------------------------

  function step(dRow, dCol) {
    if (menu) { if (dRow) pickMenuItem(menu.index + dRow); return; }
    if (moving) { moveApp(dRow, dCol); return; }
    if (dRow) {
      var target = focus.row + dRow;
      if (target < 0 || target >= rows.length || !rows[target].items.length) return;
      var x = centreOf(currentApp().el).x;
      focus.row = target;
      focus.col = nearestCol(rows[target], x);
    } else {
      var next = focus.col + dCol;
      if (next < 0 || next >= rows[focus.row].items.length) return;
      focus.col = next;
    }
    paintFocus(false);
  }

  function nearestCol(row, x) {
    var best = 0;
    var bestDistance = Infinity;
    row.items.forEach(function (app, i) {
      var distance = Math.abs(centreOf(app.el).x - x);
      if (distance < bestDistance) { best = i; bestDistance = distance; }
    });
    return best;
  }

  document.addEventListener('keydown', function (e) {
    if (launching) { e.preventDefault(); return; }
    // Up has nothing to do on the top row, so three in a row opens the diagnostics.
    if (e.keyCode === KEY.UP && focus.row === 0 && !moving && !menu) {
      if (++upPresses === 3) { upPresses = 0; toggleDiary(); }
    } else {
      upPresses = 0;
    }
    switch (e.keyCode) {
      case KEY.LEFT: step(0, -1); break;
      case KEY.RIGHT: step(0, 1); break;
      case KEY.UP: step(-1, 0); break;
      case KEY.DOWN: step(1, 0); break;
      case KEY.ENTER:
        if (!enterIsDown) {
          enterIsDown = true;
          holdFired = false;
          if (!moving && !menu) holdTimer = setTimeout(function () { holdFired = true; openMenu(); }, HOLD_MS);
        }
        break;
      case KEY.BACK:
      case KEY.ESCAPE:
        // This is the home screen, so Back only closes the menu or cancels a move.
        if (menu) closeMenu();
        else if (moving) cancelMoving();
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // Apps open on release, so holding OK can bring up the menu instead.
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.ENTER || !enterIsDown) return;
    enterIsDown = false;
    clearTimeout(holdTimer);
    e.preventDefault();
    if (holdFired || launching) return;
    if (menu) chooseMenuItem();
    else if (moving) finishMoving();
    else activate(currentApp());
  });

  function activate(app) {
    if (!app) return;
    if (app.id === HIDDEN_TILE) unhideAll();
    else if (app.id === SAMSUNG_TILE) letSamsungStay();
    else open(app);
  }

  // The helper otherwise replaces Samsung's screen with Skylight as soon as it appears.
  function letSamsungStay() {
    pausedUntil = Date.now() + 180000;
    tellHelper({ cmd: 'pause', seconds: 180 });
    captionNote.textContent = 'Press Home on the remote. Samsung’s screen will stay for 3 minutes.';
  }

  var helperChecks = 0;

  function tellHelperToGuard() {
    var shown = [];
    rows.forEach(function (row) { row.items.forEach(function (it) { if (!it.special) shown.push(it.id); }); });
    tellHelper({ cmd: 'guard', shown: shown.join(',') },
      null, function (err) { note('helper would not start (' + (err && err.name) + ')'); });
    // A few seconds later, make sure it is actually up; ask again a couple of times if not.
    setTimeout(function () {
      helperGet('log', function (text) {
        if (text) { if (!helperChecks) note('helper is up'); helperChecks = 0; return; }
        if (++helperChecks <= 3) { note('helper not reachable yet; asking it to start again (' + helperChecks + ')'); tellHelperToGuard(); }
        else note('helper is not running; Skylight handles returns by itself');
      });
    }, 5000);
  }

  // ---- Hold-OK menu: move or hide ------------------------------------------------------------

  function openMenu() {
    var app = currentApp();
    if (!app || app.special) return;
    menu = { app: app, index: 0 };
    byId('menuTitle').textContent = app.name;
    var at = centreOf(app.el);
    var height = app.el.offsetHeight * 1.1;
    // Sits just above the tile: anchored by its bottom edge.
    menuEl.style.transform = 'translate3d(' + Math.round(at.x) + 'px, ' + Math.round(at.y - height / 2 - 24) + 'px, 0) translateY(-100%)';
    menuEl.classList.add('is-open');
    pickMenuItem(0);
  }

  function pickMenuItem(index) {
    var items = menuEl.querySelectorAll('.menu-item');
    menu.index = Math.max(0, Math.min(items.length - 1, index));
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('is-focused', i === menu.index);
  }

  function chooseMenuItem() {
    var action = menuEl.querySelectorAll('.menu-item')[menu.index].getAttribute('data-action');
    var app = menu.app;
    closeMenu();
    if (action === 'move') startMoving();
    if (action === 'hide') hideApp(app);
  }

  function closeMenu() {
    menu = null;
    menuEl.classList.remove('is-open');
  }

  function hideApp(app) {
    var hidden = list('hidden');
    if (hidden.indexOf(app.id) < 0) hidden.push(app.id);
    save('hidden', hidden.join(','));
    var col = focus.col;
    buildRows();
    render();
    focus.col = Math.min(col, Math.max(0, rows[focus.row].items.length - 1));
    if (!rows[focus.row].items.length) focus.row = 1 - focus.row;
    paintFocus(false);
  }

  function unhideAll() {
    save('hidden', '');
    buildRows();
    render();
  }

  // ---- Moving --------------------------------------------------------------------------------

  function startMoving() {
    var app = currentApp();
    if (!app || app.special) return;
    moving = { id: app.id, snapshot: rows.map(function (row) { return row.items.slice(); }) };
    rows.forEach(function (row) { row.el.classList.add('is-arranging'); });
    paintFocus(false);
  }

  // Left/right swaps with the neighbour; up/down carries the app into the other row.
  function moveApp(dRow, dCol) {
    var row = rows[focus.row];
    var app = row.items[focus.col];
    if (dCol) {
      var to = focus.col + dCol;
      if (to < 0 || to >= row.items.length || row.items[to].special) return;
      row.items[focus.col] = row.items[to];
      row.items[to] = app;
      focus.col = to;
    } else {
      var target = focus.row + dRow;
      if (target < 0 || target >= rows.length) return;
      var x = centreOf(app.el).x;
      var other = rows[target];
      var at = other.items.length ? nearestCol(other, x) : 0;
      if (other.items.length && x > centreOf(other.items[at].el).x) at++;
      // Keep the "Hidden apps" tile at the end of its row.
      while (at > 0 && other.items[at - 1] && other.items[at - 1].special) at--;
      row.items.splice(focus.col, 1);
      other.items.splice(at, 0, app);
      focus.row = target;
      focus.col = at;
    }
    rows.forEach(function (r) { r.items.forEach(function (it) { r.el.appendChild(it.el); }); });
    paintFocus(false);
  }

  function finishMoving() {
    rows.forEach(function (row) {
      var ids = row.items.filter(function (app) { return !app.special; }).map(function (app) { return app.id; });
      save('order.' + row.key, ids.join(','));
    });
    if (!hintSeen) { hintSeen = true; save('hintSeen', '1'); }
    endMoving();
  }

  function cancelMoving() {
    rows.forEach(function (row, i) { row.items = moving.snapshot[i]; });
    endMoving();
  }

  function endMoving() {
    var id = moving.id;
    rows.forEach(function (row) { row.el.classList.remove('is-arranging'); });
    moving = null;
    restoreFocus(id);
    render();
  }

  // ---- Opening apps --------------------------------------------------------------------------

  function open(app) {
    launching = true;
    save('opened.' + app.id, String(Date.now()));
    curtain.style.setProperty('--c', app.tile);
    curtain.classList.add('is-on');
    setTimeout(function () {
      launchInGroup(app.id, function () {
        // Both the helper and this page watch; whichever notices first brings Skylight back.
        askHelper(app);
        startWatching(app);
        // The TV hides this page once the app is up; if it never does, uncover after a while.
        setTimeout(function () { if (!document.hidden) uncover(); }, 6000);
      }, function () { uncover(); showLaunchError(app); });
    }, 170);
  }

  // Opens an app as part of Skylight's own app group, so when it closes the TV returns here
  // rather than to Samsung's home. Apps that refuse that are opened the ordinary way, and the
  // watcher below covers them.
  function launchInGroup(id, onLaunched, onFailed) {
    function plain(reason) {
      note('opened ' + id + ' the ordinary way (' + reason + ')');
      try { tizen.application.launch(id, onLaunched, onFailed); } catch (e) { onFailed(); }
    }
    try {
      var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default',
        null, null, null, [], 'GROUP');
      tizen.application.launchAppControl(control, id, function () {
        note('opened ' + id + ' in Skylight’s group');
        onLaunched();
      }, function (err) { plain('group refused: ' + (err && err.name)); });
    } catch (e) {
      plain('groups unavailable: ' + e.name);
    }
  }

  // ---- Coming back when an app closes --------------------------------------------------------
  // When an app exits, Samsung shows its own home and tells other apps nothing. So while an app
  // opened from here is running, something has to keep checking whether it is still there, and
  // once it has closed, bring Skylight back. It stays out of the way if you have since opened
  // something else (another app, live TV or Settings), and the Home button keeps going to
  // Samsung's home.
  //
  // The checking is handed to the background helper (service/index.js), which the TV runs as its
  // own process, so it carries on even if this page is frozen while a heavy app plays. If the
  // helper can't be started, this page does the same checks itself, below.

  var HELPER_URL = 'http://127.0.0.1:8130/';

  // Commands reach the helper two ways: as a service request (which also starts it if it isn't
  // running) and over its local port. Either is enough; both are tried.
  function tellHelper(data, onDone, onFailed) {
    var query = [];
    for (var key in data) query.push(key + '=' + encodeURIComponent(String(data[key])));
    helperGet(data.cmd + '?' + query.join('&'), function () {});
    try {
      var items = [];
      for (var k in data) items.push(new tizen.ApplicationControlData(k, [String(data[k])]));
      var control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service', null, null, null, items);
      tizen.application.launchAppControl(control, HELPER_ID, onDone || function () {}, onFailed || function () {});
    } catch (e) {
      if (onFailed) onFailed(e);
    }
  }

  function helperGet(path, done) {
    // The desktop preview and the live demo have no helper, and a web page asking for 127.0.0.1
    // makes the browser ask for local-network access, so they skip it.
    if (window.SKYLIGHT_PREVIEW) { setTimeout(function () { done(null); }, 0); return; }
    var finished = false;
    function finish(text) { if (!finished) { finished = true; done(text); } }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', HELPER_URL + path, true);
      xhr.timeout = 1500;
      xhr.onload = function () { finish(xhr.status === 200 ? xhr.responseText : null); };
      xhr.onerror = xhr.ontimeout = xhr.onabort = function () { finish(null); };
      xhr.send();
    } catch (e) {
      finish(null);
    }
  }

  function askHelper(app) {
    var shown = [];
    rows.forEach(function (row) { row.items.forEach(function (it) { if (!it.special) shown.push(it.id); }); });
    tellHelper({ cmd: 'watch', app: app.id, shown: shown.join(',') },
      function () { note(app.name + ': asked the helper to watch'); },
      function (err) { note(app.name + ': helper would not start (' + (err && err.name) + ')'); });
  }

  // The TV's status service reports for any app whether it is running and on screen, which works
  // even for YouTube and TizenTube (which run inside a Samsung engine that never leaves the list
  // of running apps). If it won't answer this page, the list of running apps is used instead.

  var watch = null; // { app, baseline, seen, stops, started, timer }

  function runningApps(done) {
    try {
      tizen.application.getAppsContext(function (contexts) {
        done(contexts.map(function (c) { return c.appId; }));
      }, function () { done(null); });
    } catch (e) {
      done(null);
    }
  }

  function startWatching(app) {
    stopWatching();
    runningApps(function (ids) {
      // If the TV won't say what is running, don't guess.
      if (!ids) { note(app.name + ': the TV would not list running apps'); return; }
      var baseline = {};
      ids.forEach(function (id) { baseline[id] = true; });
      watch = { app: app, baseline: baseline, seen: false, hiddenSince: 0, busy: false, stops: 0, started: Date.now(), timer: null };
      apiState(app.id, function (state) {
        if (!watch || watch.app !== app) return;
        if (state) {
          note(app.name + ': watching through the TV’s app status');
          watch.timer = setInterval(checkApi, 1000);
        } else {
          note(app.name + ': app status not reachable from here, watching the running apps instead');
          watch.timer = setInterval(checkRunning, 600);
        }
      });
    });
  }

  function stopWatching() {
    if (watch && watch.timer) clearInterval(watch.timer);
    watch = null;
  }

  // True while the watched app has the screen. Ends the watch if it never took the screen at all
  // (resume() ends it once we are back).
  function stillAway() {
    if (!watch) return false;
    if (!document.hidden) {
      if (Date.now() - watch.started > 10000) stopWatching();
      return false;
    }
    return true;
  }

  function checkRunning() {
    if (!stillAway()) return;
    runningApps(function (ids) {
      if (!watch || !ids) return;
      if (ids.indexOf(watch.app.id) >= 0) { watch.seen = true; return; }
      if (!watch.seen) {
        if (Date.now() - watch.started > 10000) { note(watch.app.name + ' never showed up as running'); stopWatching(); }
        return; // still starting up
      }
      settle(ids);
    });
  }

  function checkApi() {
    if (!stillAway() || watch.busy) return;
    apiState(watch.app.id, function (state) {
      if (!watch || !state) return;
      if (state.running && state.visible) {
        watch.seen = true;
        watch.hiddenSince = 0;
        watch.stops = 0;
        return;
      }
      if (!watch.seen) {
        if (Date.now() - watch.started > 30000) { note(watch.app.name + ' never came on screen'); stopWatching(); }
        return;
      }
      if (!state.running) {
        // Two "not running" answers in a row, so a hiccup in the service doesn't count as an exit.
        if (++watch.stops < 2) return;
        runningApps(function (ids) { if (watch) settle(ids || []); });
        return;
      }
      // Still running but off screen: exiting YouTube leaves it like this, and so does pressing
      // Home. Give the screen a moment to settle, then see what is showing now.
      if (!watch.hiddenSince) { watch.hiddenSince = Date.now(); return; }
      if (Date.now() - watch.hiddenSince < 1500) return;
      watch.busy = true;
      var others = [];
      rows.forEach(function (row) { row.items.forEach(function (it) { if (it.id !== watch.app.id && !it.special) others.push(it); }); });
      visibleAmong(others, function (visible) {
        if (!watch) return;
        watch.busy = false;
        var left = watch.app;
        if (visible.length) {
          note(left.name + ' was replaced by ' + visible[0].name + '; following that instead');
          startWatching(visible[0]);
          return;
        }
        stopWatching();
        note('coming back; ' + left.name + ' left the screen');
        bringBack();
      });
    });
  }

  // Which of these apps the TV says are on screen right now.
  function visibleAmong(apps, done) {
    var pending = apps.length;
    var visible = [];
    if (!pending) { done(visible); return; }
    apps.forEach(function (app) {
      apiState(app.id, function (state) {
        if (state && state.running && state.visible) visible.push(app);
        if (--pending === 0) done(visible);
      });
    });
  }

  // The app has closed: come back, unless another app we show has been opened since.
  function settle(ids) {
    var app = watch.app;
    var shown = {};
    rows.forEach(function (row) { row.items.forEach(function (it) { shown[it.id] = true; }); });
    var openedSince = ids.filter(function (id) {
      return id !== app.id && id !== selfId() && !watch.baseline[id] && shown[id];
    });
    stopWatching();
    if (openedSince.length) { note(app.name + ' closed, but ' + openedSince.join(' ') + ' was opened since'); return; }
    note('came back after ' + app.name + ' closed');
    bringBack();
  }

  // The TV's own status for one app, from its local status service (which answers only to
  // callers on the TV itself): { running, visible }, or null if it won't say.
  function apiState(id, done) {
    if (window.SKYLIGHT_PREVIEW) { setTimeout(function () { done(null); }, 0); return; }
    var finished = false;
    function finish(state) { if (!finished) { finished = true; done(state); } }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'http://127.0.0.1:8001/api/v2/applications/' + id, true);
      xhr.timeout = 1500;
      try { xhr.setRequestHeader('Cache-Control', 'no-cache'); } catch (e) { /* not allowed here */ }
      xhr.onload = function () {
        try {
          var info = JSON.parse(xhr.responseText);
          finish(xhr.status === 200 && typeof info.running === 'boolean' ? { running: info.running, visible: !!info.visible } : null);
        } catch (e) {
          finish(null);
        }
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = function () { finish(null); };
      xhr.send();
    } catch (e) {
      finish(null);
    }
  }

  function selfId() {
    try { return tizen.application.getCurrentApplication().appInfo.id; } catch (e) { return 'skylightTV.Skylight'; }
  }

  // The same request Samsung's home uses to resume an app, so Skylight returns without reloading.
  function bringBack() {
    var id = selfId();
    try {
      var resume = new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume');
      tizen.application.launchAppControl(resume, id, null, function () { tizen.application.launch(id); });
    } catch (e) {
      try { tizen.application.launch(id); } catch (e2) { /* nothing more to try */ }
    }
  }

  function uncover() {
    launching = false;
    curtain.classList.remove('is-on');
  }

  function showLaunchError(app) {
    captionNote.textContent = app.name + ' didn’t open. It may have been removed from the TV.';
    captionNote.classList.add('is-error');
  }

  // ---- Clock ---------------------------------------------------------------------------------

  function tick() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var shown = (h % 12 || 12) + ':' + (m < 10 ? '0' + m : m);
    if (byId('time').textContent !== shown) {
      byId('time').textContent = shown;
      if (screen.classList.contains('is-ready')) restart(byId('time').parentNode, 'is-tick');
    }
    byId('meridiem').textContent = h < 12 ? 'am' : 'pm';
    byId('greeting').textContent = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
    byId('date').textContent = DAYS[now.getDay()] + ' ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
    Scenery.update(now);
    if (currentApp() && !moving) showCaption(currentApp());
    clearTimeout(tickTimer);
    tickTimer = setTimeout(tick, 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 50);
  }

  // ---- Lifecycle -----------------------------------------------------------------------------

  // The layout is fixed at 1920x1080; shrink it to fit, centred, when previewed in a smaller window.
  function fit() {
    var scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    if (Math.abs(scale - 1) < 0.001) { screen.style.transform = ''; return; }
    var x = Math.round((window.innerWidth - 1920 * scale) / 2);
    var y = Math.round((window.innerHeight - 1080 * scale) / 2);
    screen.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')';
  }

  // The entrance plays once, when the screen is first actually seen (the TV may start the app
  // hidden in the background so that it opens instantly later).
  function reveal() {
    revealPending = false;
    screen.classList.add('is-ready', 'is-entering');
    setTimeout(function () { screen.classList.remove('is-entering'); }, 1600);
  }

  function refreshApps(first) {
    readInstalled(function (apps) {
      var key = apps ? apps.map(function (a) { return a.id; }).sort().join('|') : 'catalog';
      if (!first && key === installedKey) return;
      installedKey = key;
      installed = apps;
      buildRows();
      render();
      tellHelperToGuard();
      if (!first) return;
      if (document.hidden) revealPending = true;
      else reveal();
    });
  }

  function resume() {
    clearTimeout(homeCheck);
    stopWatching();
    tellHelper({ cmd: 'stop' });
    uncover();
    if (menu) closeMenu();
    tick();
    if (revealPending) reveal();
    refreshApps(false);
  }

  // Losing the screen without having opened anything means the Home button (or standby). Samsung's
  // screen is up, so after a moment, if no app of ours has taken over, Skylight comes back.
  var pausedUntil = 0; // set by the Samsung tile
  var homeCheck = null;
  var hiddenAt = 0;
  var wokeAt = 0;
  var lastTick = Date.now();
  var BOOT_SOURCES = ['org.tizen.tv-viewer', 'HEPsqFNie0.tvplusstandalone'];

  // A long gap between ticks means the TV was in standby and has just woken up.
  setInterval(function () {
    var now = Date.now();
    if (now - lastTick > 20000) { wokeAt = now; note('the TV woke up'); if (document.hidden && !launching && !watch) scheduleHomeCheck(1); }
    lastTick = now;
  }, 1000);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { resume(); return; }
    if (launching || watch) return; // an app we opened took the screen; the watcher handles it
    hiddenAt = Date.now();
    helperGet('away', function () {});
    note('left the screen without opening anything (Home, or standby)');
    scheduleHomeCheck(1);
  });

  function scheduleHomeCheck(attempt) {
    clearTimeout(homeCheck);
    homeCheck = setTimeout(function () {
      if (!document.hidden || launching || watch) return;
      if (Date.now() < pausedUntil) { note('staying away: Samsung’s screen was asked for'); return; }
      var others = [];
      rows.forEach(function (row) { row.items.forEach(function (it) { if (!it.special) others.push(it); }); });
      visibleAmong(others, function (visible) {
        if (!document.hidden || launching || watch) return;
        // Right after a wake-up, the tuner or TV Plus is just where the TV landed, not a choice.
        var justWoke = wokeAt > hiddenAt && Date.now() - wokeAt < 90000;
        var onlySources = visible.length && visible.every(function (app) { return BOOT_SOURCES.indexOf(app.id) >= 0; });
        if (visible.length && !(justWoke && onlySources)) { note(visible[0].name + ' is on screen; staying away'); return; }
        note((visible.length ? 'the TV woke into ' + visible[0].name : 'nothing of ours is on screen') + '; coming back (try ' + attempt + ')');
        bringBack();
        if (attempt < 3) scheduleHomeCheck(attempt + 1);
      });
    }, attempt === 1 ? 1500 : 2500);
  }
  document.addEventListener('skylight:resume', resume);
  window.addEventListener('resize', fit);

  fit();
  // On the TV itself the scenery is rendered the cheap way; the desktop preview shows the full
  // version unless the address has ?lean.
  Scenery.init({ lean: (!!window.tizen && !window.SKYLIGHT_PREVIEW) || /[?&]lean\b/.test(location.search) });
  tick();
  refreshApps(true);
  note('Skylight ' + version + ' started');
})();
