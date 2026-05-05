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

1. **Phase A — Identification.** The Siemens PLC sends a TCP message to the IPC on port `9500` containing the part reference (plain text `PR-12345\n` or JSON `{"partRef":"PR-12345"}\n`). The app auto-generates a Part ID in the format `<Ref>T<ddmmyyyy>_<hhmmss>` (e.g. `PR-12345T05052026_143055`) and prints the QR label via Zebra TCP/9100. The operator can also trigger printing manually from the UI.
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
# 1. Install all deps (electron + electron-builder are devDependencies,
#    better-sqlite3 + chokidar are optionalDependencies)
npm install

# 2. Build the renderer + launch in dev
npm run build
npm run electron
```

## Build a Windows installer (.msi / .exe)

`electron-builder` is configured in `package.json` under the `build` block.
Run these on a **Windows** machine so `better-sqlite3` compiles for the target:

```bash
npm install                 # postinstall rebuilds native modules for Electron
npm run dist:msi            # → release/IQTS-Setup-<version>.msi   (recommended for managed IPCs)
npm run dist:win            # → release/IQTS-Setup-<version>.exe   (NSIS installer)
npm run dist:portable       # → release/IQTS-Setup-<version>.exe   (no install)
npm run electron:build      # builds every target in package.json
```

### Installer features

- Per-machine install under `C:\Program Files\IQTS\` (requires admin).
- Desktop + Start Menu shortcuts.
- Adds Windows Firewall rules on install (and removes on uninstall):
  - TCP **9100** outbound — Zebra printer
  - TCP **9500** inbound — Siemens PLC trigger listener
- Bundled `resources/firewall-rules.bat` to re-apply rules manually.
- Drop a 256×256 `build/icon.ico` before packaging — see `build/README.md`.


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
