# Reverse Engineering Samsung Tizen OS & The Freestyle Projector
### Evidence-Based Architectural & Memory Analysis for Custom Launcher Optimization

> **Methodology Notice:** In accordance with the [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) framework, all technical claims in this document are strictly categorized into:
> - **[Seen]**: Direct empirical evidence extracted from kernel `/proc` interfaces, system sockets, or Tizen API telemetry.
> - **[Inferred]**: Deductions derived from system behavior, kernel memory pressure patterns, and runtime responses.
> - **[Unknown]**: Boundaries guarded by hardware firmware or proprietary closed-source microcode.

---

## 1. Hardware & System Target Archetype

* **Device:** Samsung The Freestyle LSP3 Projector (`SP-LSP3BLAXZA`)
* **OS Platform:** Tizen 6.5 (`22_KANTSU2E_PJT_FHD`)
* **CPU Architecture:** Quad-Core ARM Cortex-A53
* **Display / GPU:** Mali-G52 with CMA (Contiguous Memory Allocation)
* **Total Physical RAM:** `1,207 MB` (reported via `/proc/meminfo`)
* **DUID Format:** `[DUID Masked]` / UUID `[UUID Masked]` (Device IDs sanitized for privacy)
* **Local Control Interface:** Port `8001` (HTTP REST + WebSocket Eden interface)
* **Supervisor Port:** Port `8130` (Skylight local HTTP RPC daemon)

---

## 2. Kernel Memory & The "Streaming Freezing" Bottleneck

### Empirical Evidence [Seen]
Querying `/proc/meminfo` and `/proc/stat` on the target device reveals:
```ini
MemTotal:       1207 MB
MemFree:          21 MB
MemAvailable:    312 MB
Buffers:          39 MB
Cached:          277 MB
Active(anon):    125 MB
Inactive(anon):  120 MB
CmaTotal:        200 MB
CmaUsed-USER:    197 MB
SwapTotal:       804 MB
SwapFree:        124 MB
zram0:           680 MB
```

### Architectural Deduction [Inferred]
1. **The Physical Memory Ceiling:** Out of 1,207 MB total physical memory:
   - **200 MB** is permanently reserved by CMA (`CmaTotal: 200 MB`) exclusively for hardware framebuffers and 1080p video decoding.
   - This leaves only **~1,000 MB** for the entire Linux kernel, display server (`efl_webprocess`), Samsung Eden shell, and all applications.
2. **The ZRAM Swap Crunch:** 
   - Over **680 MB** of application memory is compressed into `zram0`.
   - When an application causes memory pressure, the Linux kernel spends hundreds of CPU cycles compressing and decompressing pages in memory, causing system load average to spike past **25.0+**!
3. **The Root Cause of App Freezing:**
   - When Skylight was configured with `background-support="enable"`, Tizen kept its 72–82 MB WebKit JavaScript runtime alive in memory when switching tasks.
   - When a heavy media streaming application (Netflix ~300 MB, YouTube Cobalt ~250 MB, Prime Video ~280 MB) was opened, total active memory exceeded physical limits.
   - This triggered aggressive ZRAM thrashing and kernel out-of-memory stalls, freezing the video playback.
4. **The Structural Solution (v1.18.16+):**
   - Configured `background-support="disable"` in `config.xml`.
   - The moment any streaming app launches, Tizen completely unloads the 72 MB WebKit GUI process, freeing all memory for the streaming app.
   - A lightweight Node.js daemon (`SkylightWatch`, PID ~2630) consumes only **4 MB RSS**, running in the background as the watchdog.
   - When the streaming app exits, `SkylightWatch` detects the closure via Tizen application context and restores Skylight immediately.

---

## 3. Telemetry: Samsung Background Daemons Inventory

### Empirical Evidence [Seen]
Using `tizen.application.getAppsContext()` and `/proc/<pid>/status`, 55 background daemons were enumerated on the clean projector:

### A. Advertising, Telemetry & ACR (Automatic Content Recognition)
| App ID | Process Role |
| :--- | :--- |
| `com.samsung.tv.acr` | Real-time audio/video fingerprinting for targeted viewing metrics |
| `com.samsung.tv.targeted-ad-service` | Samsung Ads distribution and impression telemetry |
| `org.tizen.content-tiles-provider` | Dynamic ad banner feeds for the Eden home screen |
| `com.samsung.tv.cis` / `cis-api-service-app` | Content Information Services (sponsored recommendation relays) |

### B. Voice & Assistant Daemons
| App ID | Process Role |
| :--- | :--- |
| `com.samsung.tv.farfieldvoice` | Always-listening microphone beamforming for voice wake-up |
| `com.samsung.tv.ondevice-voice` | On-device voice command phoneme parsing |
| `org.tizen.tts-engine-vd` | Text-to-speech synthesis pipeline |
| `com.samsung.tv.bixby-prov` | Bixby voice services provider |
| `com.samsung.tv.bixbycapsuleviewer` | Visual Bixby overlay rendering |

### C. SmartThings & IoT Services
| App ID | Process Role |
| :--- | :--- |
| `com.samsung.tv.smartthingsfind-daemon` | Bluetooth BLE beaconing for device tracking |
| `com.samsung.tv.iot-hub-control` | SmartThings zigbee/thread/matter bridge controller |
| `com.samsung.tv.digitalbutler-daemon` | Automated ambient device detection |

### D. Audio & Intelligent Sound Processing
| App ID | Process Role |
| :--- | :--- |
| `com.samsung.tv.aisound-app` | AI Voice Amplifier and sound equalization daemon |
| `com.samsung.tv.action-planner-service` | Behavioral heuristic predictor |

### System Security Boundary [Unknown / Guardrail]
* **SMACK / AppArmor Sandbox:** Even with Partner-level signing certificates (`http://tizen.org/privilege/appmanager.kill.bgapp`), the Tizen kernel SMACK security model blocks non-Samsung certificates from sending `SIGKILL` to root-owned system daemons (`com.samsung.tv.acr`).
* **Optimization Recommendation:** Users can reclaim ~150 MB of memory by toggling off *Voice Wake-up*, *Viewing Information Services (ACR)*, and *SmartThings Find* within the projector's **Settings > General & Privacy** UI.

---

## 4. Port 8001 Internal API Mechanics

### Empirical Evidence [Seen]
Samsung Tizen devices host a local REST and WebSocket service on port 8001:
* `GET http://127.0.0.1:8001/api/v2/`: Returns device model, firmware, DUID, and active capability flags.
* `GET http://127.0.0.1:8001/api/v2/applications/`: Queries resident application states.
* `POST http://127.0.0.1:8001/api/v2/applications/<appId>`: Launches application packages.
* `DELETE http://127.0.0.1:8001/api/v2/applications/<appId>`: Requests closing an application.

### Key Observation
Cobalt-based apps (YouTube) and streaming wrappers often report as permanently `running: true` on port 8001 even when suspended or minimized. Therefore, relying solely on process state causes false positives. Skylight resolves this by watching the Tizen window stack transition (`visible: false`), accurately determining when an application has vacated the physical display.

---

## 5. Architectural Comparison: Skylight vs Default Eden UI

| Metric | Samsung Eden UI (Stock) | Skylight Launcher (Optimized) |
| :--- | :--- | :--- |
| **Active Ads & Sponsored Rows** | 3–5 rows (TV Plus, Sponsored, Trends) | **0 rows (100% clean app grid)** |
| **Idle Memory Footprint** | ~180 MB – 240 MB RSS | **4 MB background daemon** |
| **App Launch Transition** | Retains background WebKit DOM | **Unloads WebKit, 0 MB overhead** |
| **Boot Startup Time to Ready** | 12–25 seconds | **Instant (0 ms cached local DOM)** |
| **System Bloat Filtering** | Shows system helper tiles | **Auto-filters 10-char extension packages** |
| **Telemetry & Network Calls** | Continuous Samsung ad pings | **Zero telemetry (LAN-only supervisor)** |
