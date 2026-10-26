// Stands in for the TV's `tizen` API when the page is opened in a desktop browser for preview.
// On the TV `window.tizen` already exists and this file does nothing.
(function () {
  if (window.tizen) return;
  window.SKYLIGHT_PREVIEW = true;

  var apps = [
    ['25emanual3.emanual', 'User Guide'],
    ['org.tizen.netflix-app', 'Netflix'],
    ['com.samsung.tv.SmartThingsApp', 'SmartThings'],
    ['org.tizen.primevideo', 'Prime Video'],
    ['EUKHUxrGQA.SonyLIV', 'SonyLIV'],
    ['com.samsung.tv.aria-video', 'Apple TV'],
    ['org.tizen.browser', 'Browser'],
    ['com.samsung.tv.gallery', 'Gallery'],
    ['yL49PNFmjW.PromotionApp', 'Samsung Promotion'],
    ['xvvl3S1TT1.TizenTubeStandalone', 'TizenTube'],
    ['com.samsung.tv.SecurityCenter', 'SecurityCenter'],
    ['com.samsung.tv.bixby-promotion', 'BixbyPromotion'],
    ['com.samsung.tv.AICompanionUILauncher', 'Samsung Vision AI Companion'],
    ['9Ur5IzDKqV.TizenYouTube', 'YouTube'],
    ['rJeHak5zRg.Spotify', 'Spotify - Music and Podcasts'],
    ['KCKrPXpbAS.JioCinema', 'JioCinema-Shows, Movies & More'],
    ['fiZNCxMH9Y.Hotstar', 'JioHotstar'],
    // System apps the TV also reports; the home screen should leave these out.
    ['org.tizen.tv-viewer', 'TV', false],
    ['org.tizen.menu', 'Settings', false],
    ['com.samsung.tv.store', 'Apps'],
    ['com.samsung.tv.mycontents', 'Media']
  ].map(function (a) { return { id: a[0], name: a[1], iconPath: '', show: a[2] !== false }; });

  // Preview helpers for screenshots:
  //   ?hour=21.5    pretends it is that time of day, to see the other skies
  //   ?keys=39,40   presses those keys once the apps are on screen ("h" holds OK)
  var hour = /[?&]hour=(\d+(?:\.\d+)?)/.exec(location.search);
  if (hour) {
    var RealDate = Date;
    var real = new RealDate();
    var shift = (parseFloat(hour[1]) - real.getHours() - real.getMinutes() / 60) * 3600000;
    var FakeDate = function () {
      if (!arguments.length) return new RealDate(RealDate.now() + shift);
      var args = [null].concat(Array.prototype.slice.call(arguments));
      return new (Function.prototype.bind.apply(RealDate, args))();
    };
    FakeDate.now = function () { return RealDate.now() + shift; };
    FakeDate.UTC = RealDate.UTC;
    FakeDate.parse = RealDate.parse;
    FakeDate.prototype = RealDate.prototype;
    window.Date = FakeDate;
  }

  //   ?still        skips transitions, so a screenshot shows the settled state
  if (/[?&]still\b/.test(location.search)) {
    var still = document.createElement('style');
    still.textContent = '.stage, .tile, .glow, .glare, .moon, .haze, .godrays, .glitter, .column, .curtain, .hint, .row, .menu { transition: none !important; }' +
      '.is-entering .tile, .is-entering .masthead, .is-entering .caption, .tile.is-focused, .caption-title, .clock { animation: none !important; }' +
      '.fireflies i { opacity: 0.8 !important; animation: none !important; }' +
      '.ripple { opacity: 0.4 !important; animation: none !important; transform: scale(0.6) !important; }';
    document.head.appendChild(still);
  }

  var keys = /[?&]keys=([\dh,]+)/.exec(location.search);
  if (keys) {
    var queue = keys[1].split(',');
    var press = function (code, holdMs, then) {
      ['keydown', 'keyup'].forEach(function (type, i) {
        setTimeout(function () {
          var e = new KeyboardEvent(type, { bubbles: true });
          Object.defineProperty(e, 'keyCode', { get: function () { return code; } });
          document.dispatchEvent(e);
          if (i === 1) setTimeout(then, 300);
        }, i * holdMs);
      });
    };
    var next = function () {
      if (!queue.length) return;
      var key = queue.shift();
      if (key === 'h') press(13, 800, next);
      else press(Number(key), 40, next);
    };
    var waitForApps = setInterval(function () {
      if (!document.querySelector('.tile')) return;
      clearInterval(waitForApps);
      setTimeout(next, 400);
    }, 50);
  }

  // The TV needs the page laid out at 1920 pixels; a phone browser would then shrink everything,
  // this bar included, to a fifth. In a browser the page fits itself to the window instead.
  var viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1');

  //   (no ?still)   shows the demo bar: the keys to use, and the sky at other times of day
  if (!/[?&]still\b/.test(location.search)) {
    var times = [['Dawn', '6.6'], ['Noon', '12.5'], ['Golden hour', '17.1'], ['Dusk', '19.4'], ['Night', '22.4'], ['Now', '']];
    var current = hour ? hour[1] : '';
    var bar = document.createElement('nav');
    bar.className = 'demo-bar';
    bar.setAttribute('aria-label', 'Demo controls');
    var tip = document.createElement('span');
    tip.className = 'demo-tip';
    tip.textContent = 'Arrow keys move, Enter opens, hold Enter to move or hide.';
    bar.appendChild(tip);
    times.forEach(function (t) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = t[0];
      button.setAttribute('aria-pressed', String(t[1] === current));
      button.addEventListener('click', function () {
        var params = new URLSearchParams(location.search);
        if (t[1]) params.set('hour', t[1]); else params.delete('hour');
        var query = params.toString();
        location.search = query ? '?' + query : '';
      });
      bar.appendChild(button);
    });
    // Keys pressed on the bar are for the bar, not for the home screen behind it.
    bar.addEventListener('keydown', function (e) { e.stopPropagation(); });
    var barStyle = document.createElement('style');
    barStyle.textContent =
      '.demo-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 10; width: max-content;' +
      ' display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2px;' +
      ' max-width: calc(100% - 24px); padding: 5px 6px 5px 16px; border-radius: 22px;' +
      ' font: 500 14px/1.2 Atkinson, sans-serif; color: rgba(244, 238, 228, 0.82);' +
      ' background: rgba(3, 5, 26, 0.74); border: 1px solid rgba(255, 255, 255, 0.14); }' +
      '.demo-tip { margin-right: 10px; }' +
      '.demo-bar button { font: inherit; color: inherit; background: none; border: 0; border-radius: 16px; padding: 6px 11px; cursor: pointer; }' +
      '.demo-bar button:hover { background: rgba(255, 255, 255, 0.09); }' +
      '.demo-bar button[aria-pressed="true"] { background: rgba(255, 207, 147, 0.2); color: #ffe6c4; }' +
      '.demo-bar button:focus-visible { outline: 2px solid #ffcf93; outline-offset: 1px; }' +
      '@media (max-width: 720px) { .demo-tip { display: none; } .demo-bar { padding-left: 6px; } }';
    document.head.appendChild(barStyle);
    document.body.appendChild(bar);
  }

  window.tizen = {
    ApplicationControl: function (operation, uri, mime, category, data, launchMode) {
      this.operation = operation;
      this.data = data || [];
      this.launchMode = launchMode;
    },
    ApplicationControlData: function (key, value) { this.key = key; this.value = value; },
    application: {
      getAppsInfo: function (onSuccess) { setTimeout(function () { onSuccess(apps); }, 20); },
      getAppsContext: function (onSuccess) { setTimeout(function () { onSuccess([{ id: '1', appId: 'skylightTV.Skylight' }]); }, 5); },
      getCurrentApplication: function () { return { appInfo: { id: 'skylightTV.Skylight', version: 'preview' } }; },
      launchAppControl: function (control, id, onSuccess) {
        var data = control.data.map(function (d) { return d.key + '=' + d.value[0]; }).join(' ');
        console.log('[preview] app control ' + control.operation + ' (' + (control.launchMode || 'SINGLE') + ') -> ' + id + (data ? ' | ' + data : ''));
        if (onSuccess) onSuccess();
        if (control.launchMode === 'GROUP') {
          setTimeout(function () { document.dispatchEvent(new Event('skylight:resume')); }, 900);
        }
      },
      launch: function (id, onSuccess) {
        console.log('[preview] launch ' + id);
        setTimeout(function () {
          if (onSuccess) onSuccess();
          // Pretend the user came back from the app.
          setTimeout(function () { document.dispatchEvent(new Event('skylight:resume')); }, 900);
        }, 200);
      }
    }
  };
})();
