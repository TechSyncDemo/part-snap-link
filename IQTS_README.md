# IQTS — Industrial Quality Tracking System

Local web app that runs on the Industrial PC and bridges:

- **Siemens PLC** (control trigger)
- **IFM camera** (vision snapshots written to a watched folder)
- **Zebra hardware** (QR label printing over TCP/IP, USB-HID scanner)
- **SQLite** (local quality archive — no internet required)

The renderer is a TanStack Start app; the desktop wrapper is Electron.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Industrial PC (LAN-only)                                │
│                                                          │
│  ┌─────────────┐    IPC    ┌──────────────────────┐      │
│  │  Renderer   │◀─────────▶│  Electron main       │      │
│  │  (React)    │           │   • SQLite archive   │      │
│  └─────────────┘           │   • Folder watcher   │      │
│                            │   • Zebra TCP/9100   │      │
│                            └──────────────────────┘      │
│           ▲                          ▲                   │
│           │ HID scan                 │ FTP/SMB write     │
│  ┌──────────────┐           ┌────────────────┐           │
│  │ Zebra scanner│           │ IFM camera     │           │
│  └──────────────┘           └────────────────┘           │
│           ▲                                              │
│           │ TCP ZPL                                      │
│  ┌──────────────┐                                        │
│  │ Zebra printer│                                        │
│  └──────────────┘                                        │
└──────────────────────────────────────────────────────────┘
```

## Workflow

1. **Phase A — Identification.** Operator enters Part Reference and clicks *Generate Label*. The app sends ZPL over TCP/9100 to the Zebra printer; label encodes `PartRef_Timestamp`.
2. **Phase B — Capture.** PLC triggers IFM camera. Camera writes JPEG to `watchFolder` over FTP/SMB. The app's chokidar watcher detects the file. Quality status is parsed from the filename suffix (`_OK_*` / `_NOK_*`).
3. **Phase C — Pairing.** Operator scans the label. The Enter-suffixed HID scan lands in the *Scan Input* field. The app picks the most recent file in the buffer (within the configured Δt), moves it to `processedFolder` renamed to `<PartId>.jpg`, and inserts a SQLite record.
4. **Phase D — Retrieval.** Supervisor scans/searches in the *Quality Archive* panel; image and metadata appear instantly.

## Run in development

```bash
bun install
bun run dev   # vite dev server on :8080 — preview / mock mode
```

## Run as desktop app (with hardware)

```bash
# 1. Install Electron + native deps
bun add -d electron @electron/packager
bun add better-sqlite3 chokidar

# 2. Build the renderer
bunx vite build

# 3. Launch
bunx electron .
```

The first launch creates `~/.config/IQTS/iqts/`:
- `iqts.sqlite` — archive
- `config.json` — printer host/port, watch folder, association window
- `camera_in/` — drop incoming images here
- `processed/` — renamed after pairing

Edit `config.json` to point `watchFolder` at the IFM share and `printer.host` at the Zebra IP.

## Filename → status convention

| Filename pattern               | Parsed status   |
| ------------------------------ | --------------- |
| `*_OK_*`, `*_PASS_*`, `*conforme*`     | Conforme       |
| `*_NOK_*`, `*_FAIL_*`, `*non-conforme*` | Non-Conforme  |
| anything else                  | Pending         |

## Security model

- `contextIsolation: true`, `nodeIntegration: false`.
- Only a typed surface (`window.iqts.*`) is exposed via preload.
- App runs entirely on LAN — no external network calls.
