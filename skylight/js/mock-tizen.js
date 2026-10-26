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
