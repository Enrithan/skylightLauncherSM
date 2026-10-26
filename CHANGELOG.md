# Changelog

## [1.17.0] - 2026-10-26

First public release.

- A home screen for Samsung Tizen TVs: favourites and the rest as logo tiles, with Move and Hide on a
  long press of OK, a Samsung tile and a Hidden apps tile.
- Returns to Skylight when an app closes, through a background helper that asks the TV's local status
  service what is on screen.
- Returns to Skylight after the Home button, by noticing it lost the screen without opening anything.
- Starts with the TV through two SmartThings cloud rules, for standby wake and for cold boots, managed with
  `tools/smartthings-skylight.ps1`.
- A painted sky that follows the time of day, with the sun and the moon in its real phase, blended
  between dawn, day, golden hour, dusk and night.
- A lean rendering for TV hardware, chosen automatically on the TV.
- A desktop preview and a live demo, with time-of-day buttons.
- A diagnostics panel showing what Skylight and its helper noticed.

[1.17.0]: https://github.com/SaudSatopay/skylight-tizen/releases/tag/v1.17.0
