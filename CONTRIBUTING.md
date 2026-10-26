# Contributing to Skylight

Thanks for helping. Two kinds of help matter most right now.

## Reports from other TVs

Skylight has been tested on one TV. If you try it on another Samsung, please fill in the
[compatibility form](https://github.com/SaudSatopay/skylight-tizen/issues/new?template=compatibility.yml),
whether it worked or not. A photo of the diagnostics panel helps a lot: select a top-row tile and press
**Up** three times.

## Code

**Preview without a TV.** Serve the `skylight` folder with any static server and open it in a browser:

```powershell
python -m http.server 5180 --bind 127.0.0.1 --directory skylight
```

`js/mock-tizen.js` stands in for the TV's `tizen` API, and only in a browser. Useful flags: `?hour=19.4`
(any time of day), `?lean` (the TV's rendering), `?still` (no transitions, for screenshots), `?visitors`
(birds and shooting stars right away) and `?keys=39,40,13` (replay remote keys; `h` holds OK).

**Keep it smooth on a TV.** Television graphics chips are slow at blending big translucent layers every
frame. Animate only `transform` and `opacity`, keep moving things small, and put anything heavy behind
`.screen:not(.lean)` so the TV skips it. Check a change with `?lean` before sending it.

**Keep it plain.** No build step, no frameworks, no dependencies. The code is ES5-style JavaScript so it
runs on older TV browsers too. Comments explain why something is done, in plain words.

**Keep it private.** Skylight makes no network calls and collects nothing. Please keep it that way.

**Don't commit app logos.** They belong to their owners; `tools/fetch-icons.ps1` downloads them locally.

**Test on a TV when you can.** Build with `tools\build-skylight.ps1`, bump the version in `config.xml`, and
install with Apps2Samsung (see the README). Say in the pull request which TV you tested on, or that you
couldn't.
