# Project: Skylight Tizen Atmospheric Scenery & Glassmorphic UI

## Architecture
Skylight Tizen is a minimalist, ambient TV/projector launcher for Samsung The Freestyle (Tizen 6.5, Mali-G52 GPU, 1.2 GB RAM).

```
+-----------------------------------------------------------------------------------+
| Browser / WebKit UI Process (skylightTV.Skylight <= 75 MB RSS)                     |
|                                                                                   |
|   #sky (Scenery Engine - scenery.js & app.css)                                     |
|     - Time-of-Day Base Palettes (dawn, day, golden, dusk, night)                  |
|     - Atmospheric Weather Modifiers (.weather-clear, .weather-rain, etc.)         |
|     - GPU Composited Particle Planes (translate3d: rain streaks, snow flakes)      |
|     - Lighting Effects (distant lightning flash, valley mist, lake shimmer)       |
|                                                                                   |
|   .stage (UI Interface - app.js & app.css)                                        |
|     - 21st.dev Translucent Glass Cards (clock/greeting, calendar/weather badge)   |
|     - Weather Status Badge with Animated Vector Micro-Icons                       |
|     - Favourites & App Grid with Spring-Feel Focus Scaling (cubic-bezier 240ms)   |
|                                                                                   |
|   Lifecycle & Coordination (app.js)                                               |
|     - visibilitychange / document.hidden -> Scenery.pause() / Scenery.resume()     |
|     - open(app) -> curtain transition & pause animations                          |
+-----------------------------------------------------------------------------------+
                                        | (HTTP Port 8130 / Tizen AppControl)
                                        v
+-----------------------------------------------------------------------------------+
| Background Helper Daemon (SkylightWatch <= 5 MB RSS, service/index.js)             |
|   - App Watching & Relaunch on external app exit (Netflix, YouTube, Prime)        |
|   - Weather Fetcher (wttr.in) & ICS Calendar Sync                                 |
|   - System Telemetry APIs: /stats (CPU/RAM) & /procs (Process Table & RSS)        |
+-----------------------------------------------------------------------------------+
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Weather Visual Modes | Visual scenery modes: Clear, Cloudy, Rain, Thunderstorm, Mist/Fog, Snow | M1 | ORIGINAL_REQUEST R1 |
| 2 | Rain Streaks & Lake Shimmer | Hardware-accelerated diagonal streaks and lake surface ripple shimmer | M1 | ORIGINAL_REQUEST R1 |
| 3 | Thunderstorm Storm Glow | Moody darkened palette and distant sheet lightning cloud flashes | M1 | ORIGINAL_REQUEST R1 |
| 4 | Mist & Fog Depth Haze | Multi-plane depth haze shrouding mountains, pines, and horizon | M1 | ORIGINAL_REQUEST R1 |
| 5 | Snow Drifting Flakes | Soft drifting snowflakes with gentle sine sway and frosty highlights | M1 | ORIGINAL_REQUEST R1 |
| 6 | Time-of-Day Cross-fades | Smooth 1.2s cross-fade of weather effects over time-of-day palettes | M1 | ORIGINAL_REQUEST R1 |
| 7 | Deterministic Preview Param | Query parameter preview support: `?weather=rain\|thunder\|snow\|fog...` | M1 | ORIGINAL_REQUEST R1 |
| 8 | Floating Glass Cards | Translucent card surfaces with 1px luminous borders and soft shadows | M2 | ORIGINAL_REQUEST R2 |
| 9 | Spring-Feel Focus Scaling | Silky spring focus scaling `cubic-bezier(0.34, 1.45, 0.64, 1)` (240ms) | M2 | ORIGINAL_REQUEST R2 |
| 10| Ambient Tile Accent Glow | Inset luminous ring + tile-accented ambient glow (`--glow-ambient`) | M2 | ORIGINAL_REQUEST R2 |
| 11| Weather Badge & Micro-Icons | Dedicated glass badge with animated vector micro-icon and summary | M2 | ORIGINAL_REQUEST R2 |
| 12| GPU translate3d Compositing | All animations use GPU composited transforms, keeping idle CPU <= 25% | M3 | ORIGINAL_REQUEST R3 |
| 13| Lifecycle Animation Pause | Instant pause of animations & timer teardown on document.hidden/app open | M3 | ORIGINAL_REQUEST R3 |
| 14| WebKit Memory Bounds | UI process remains <= 75 MB RSS under continuous weather rendering | M3 | ORIGINAL_REQUEST R3 |
| 15| Helper Memory Bounds | SkylightWatch remains <= 5 MB RSS under continuous operation | M3 | ORIGINAL_REQUEST R3 |
| 16| Package Size Budget | Built package `dist/Skylight.wgt` remains under 680 KB | M3 | ORIGINAL_REQUEST R3 |
| 17| Streaming App Cleanliness | External apps (Netflix, YouTube, Prime) launch and return without stall | M3 | ORIGINAL_REQUEST R3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Weather Scenery Engine | Features 1, 2, 3, 4, 5, 6, 7 | None | DONE (299/299 tests pass, 651 KB wgt) |
| M2 | Glassmorphism & Micro-interactions | Features 8, 9, 10, 11 | M1 | DONE (299/299 tests pass, 654 KB wgt) |
| M3 | Memory Bounds & Lifecycle Hardening | Features 12, 13, 14, 15, 16, 17 | M1, M2 | IN_PROGRESS |
| M4 | Final E2E & Adversarial Hardening | 100% E2E test pass + Tier 5 adversarial stress testing | M1, M2, M3, E2E | PLANNED |

## Interface Contracts

### Scenery Engine ↔ UI Controller (`scenery.js` ↔ `app.js`)
- `Scenery.init(options)`: Initializes scenery engine (`options: { lean: boolean }`).
- `Scenery.setWeather(weatherData)`: Accepts `{ tempC, tempF, desc, sunrise, sunset, city }`. Classifies weather condition into `'clear' | 'cloudy' | 'rain' | 'thunder' | 'mist' | 'snow'` and applies class modifier to `#screen`.
- `Scenery.setWeatherMode(mode)`: Programmatic override for deterministic preview (`'rain'`, `'thunder'`, etc.).
- `Scenery.pause()`: Immediately halts all CSS animations (`.weather-paused` class on `#screen`) and clears scheduled visitor timers.
- `Scenery.resume()`: Resumes CSS animations and re-schedules time-of-day/visitor ticks.

### App Controller ↔ Weather Badge (`app.js` ↔ DOM)
- `updateWeatherBadge(weatherData)`:
  - Injects animated vector micro-icon into `#weatherMicroIcon`.
  - Sets text content on `#weatherTemp` and `#weatherDesc`.
  - Hides/shows badge gracefully with CSS transition.

### Lifecycle ↔ System / Watcher (`app.js` ↔ `SkylightWatch`)
- `open(app)`: Calls `Scenery.pause()` before firing `tizen.application.launch` and notifying helper via `http://127.0.0.1:8130/watch`.
- `document.addEventListener('visibilitychange')`: Calls `Scenery.pause()` when `document.hidden === true`, and `Scenery.resume()` on returning.

## Code Layout
- `skylight/index.html`: DOM structure for scenery weather layers, glass cards, and weather badge.
- `skylight/js/scenery.js`: Scenery engine, weather classification, time-of-day palette blending, pause/resume.
- `skylight/js/app.js`: UI coordinator, weather badge updating, focus navigation, lifecycle events.
- `skylight/js/mock-tizen.js`: Browser preview harness, query parameter parsing, interactive demo bar toggles.
- `skylight/css/app.css`: Styles for weather layers, keyframe animations, glass cards, focus spring curves.
- `tools/build-skylight.ps1`: Tizen packaging script, output size verification.
