# E2E Test Infra: Skylight Tizen Scenery & Glassmorphic UI

## Test Philosophy
- Requirement-driven, opaque-box testing derived directly from `ORIGINAL_REQUEST.md`.
- No reliance on internal implementation details.
- Multi-tier validation: Category-Partition, Boundary Value Analysis, Pairwise Combinations, and Real-World Device Telemetry Workloads.

## Feature Inventory
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|----------------------|:------:|:------:|:------:|
| 1 | Weather Visual Modes (6 modes) | ORIGINAL_REQUEST R1 | 6 | 6 | ✓ |
| 2 | Rain Streaks & Lake Shimmer | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 3 | Thunderstorm Storm Glow | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 4 | Mist & Fog Depth Haze | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 5 | Snow Drifting Flakes | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 6 | Time-of-Day Cross-fades | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 7 | Deterministic Preview Param | ORIGINAL_REQUEST R1 | 6 | 6 | ✓ |
| 8 | Floating Glass Cards | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 9 | Spring-Feel Focus Scaling | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 10| Ambient Tile Accent Glow | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 11| Weather Badge & Micro-Icons | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 12| GPU translate3d Compositing | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 13| Lifecycle Animation Pause | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 14| WebKit Memory Bounds (<= 75MB) | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 15| Helper Memory Bounds (<= 5MB) | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 16| Package Size Budget (<= 680KB) | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 17| Streaming App Cleanliness | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Node.js & PowerShell test harnesses under `tests/e2e/`:
  - `tests/e2e/run-all.ps1`: master execution script running tiers 1–4.
  - `tests/e2e/tier1-features.js`: tests DOM structure, weather classes, query parameters, card elements.
  - `tests/e2e/tier2-boundaries.js`: edge cases (rapid weather switching, unknown weather string, negative temperatures, boundary hours).
  - `tests/e2e/tier3-combinations.js`: pairwise combinations (each weather mode across each of the 5 time-of-day palettes + focus states).
  - `tests/e2e/tier4-device-telemetry.ps1`: live device telemetry assertions against `http://192.168.40.15:8130/procs` and `/stats`.
- **Pass/Fail Semantics**: All test suites must exit with code 0.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Target Criterion |
|---|----------|--------------------|------------------|
| 1 | Continuous Rain Telemetry | F1, F2, F6, F12, F14 | WebKit RSS <= 75 MB after 5 minutes |
| 2 | System Idle CPU Check | F1, F2, F3, F5, F12 | System CPU load <= 25% |
| 3 | Package Build & Size Audit | F16 | `dist/Skylight.wgt` <= 680 KB |
| 4 | External App Launch & Return | F13, F15, F17 | SkylightWatch <= 5MB RSS, clean return |
| 5 | Full Weather Cycle Tour | F1-F7, F11 | Seamless cross-fades through all 6 modes |

## Coverage Thresholds
- Tier 1: >= 5 tests per feature (minimum 85 test cases)
- Tier 2: >= 5 boundary test cases per feature (minimum 85 test cases)
- Tier 3: Pairwise coverage across 6 weather modes × 5 time-of-day segments
- Tier 4: >= 5 realistic live workload scenarios
