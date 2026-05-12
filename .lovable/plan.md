## New workflow (per your description)

```
Operator works → PLC sends end-of-op signal
        ↓
App generates Part ID (PR-xxxxxT<date>_<time>)
        ↓
App grabs the LATEST image from the IFM folder
        ↓
Read its Conforme / Non-Conforme status (from filename)
        ↓
Rename that image to <PartID>.<ext> in the processed folder
        ↓
   Conforme? ──Yes──► Print QR label (Zebra TCP/9100)
        │
        └──No──► Save record only, NO print, alert operator
        ↓
Archive in SQLite + show in history
```

No barcode scanner. No "pairing" step. The Part ID printed on the label IS the image filename — they're already linked at generation time.

---

## Changes

### 1. Electron (`electron/main.cjs`) — core logic rewrite of the PLC handler
- On PLC trigger:
  1. Generate `partId = formatPartId(partRef)`
  2. Pick the **most recent file** in `watchFolder` (fallback: newest of `pending[]` buffer; if none, wait up to N ms)
  3. Determine status from filename (`_OK_` / `_NOK_` etc. — already implemented in `parseStatus`)
  4. Move/rename to `processedFolder/<partId>.<ext>`
  5. **If Conforme** → send ZPL to Zebra. **If Non-Conforme** → skip print, mark record.
  6. Insert record in SQLite with image path, status, station, operator
  7. Emit a single new event `iqts:partProcessed` to the renderer with the full record
- Keep the existing TCP PLC listener; reply `OK <partId> PRINTED` / `OK <partId> NO_PRINT (NCR)` / `ERR ...`
- Add a small config: `requireConformToPrint: true`, `imageWaitMs: 2000` (how long to wait for a fresh IFM image after PLC signal before falling back to the latest existing file).

### 2. Bridge (`src/lib/iqts-bridge.ts`)
- Replace `associateScan` with `processPart(partRef)` returning the full `PartRecord` (printed flag included).
- Add `onPartProcessed(cb)` event subscription (replaces `onPendingChange` for the live feed; pending buffer becomes optional/diagnostic).
- Update mock implementation to mirror the new flow: on `mockPlcTrigger` (or new `mockProcess`), pick the latest mock image, rename, decide print, emit event.
- Keep types (`PartRecord`, `QualityStatus`) unchanged.

### 3. UI (`src/routes/index.tsx`, `src/components/iqts/*`)
- **Delete** `ScanCapture.tsx` (no scanning anymore).
- **Rename** sections to match the real flow:
  - Phase A — Operation & Trigger (LabelGenerator, now showing PLC status + manual override)
  - Phase B — Last Processed Part (live card: image, status pill, partId, print result)
  - Phase C — Archive (HistoryPanel, unchanged)
- `LabelGenerator`:
  - Drop manual "Generate Label" as the primary action (keep it as a small "Manual trigger" button for testing).
  - Show clearly: "Waiting for PLC…" / "Processing <partId>…" / last result.
  - In browser preview keep the "Simulate PLC" button (and Pass/Fail selector for the mock image status).
- New `LastProcessed.tsx` card: large image preview, status pill, partId, print outcome (Printed / Skipped — Non-Conforme / Print failed).

### 4. Status banner & errors
- If PLC fires but no image is found in the IFM folder within `imageWaitMs` → show a "No image from IFM" warning, save no record, do not print.
- If image is Non-Conforme → status pill red, "Label NOT printed (quality fail)".

---

## Out of scope (kept as-is)
- Zebra ZPL format, Siemens TCP listener protocol, SQLite schema, settings, station/operator display, responsive/dense layout, Electron build pipeline.

---

## Open questions before I implement
1. **Non-Conforme behavior**: skip print entirely (my assumption), or print a different "REJECT" label?
2. **No-image case**: if the PLC fires but the IFM folder has no fresh image, should I (a) abort silently, (b) print anyway with status "Pending", or (c) retry for a few seconds then alert?
3. **"Last image" definition**: newest file by mtime in `watchFolder`, or only files created **after** the PLC signal (waiting up to `imageWaitMs`)? The second is safer but adds latency.
