# ChapLab Gas Tank Inventory v12

This rebuild fixes the scan/manual lookup issue by using one shared `handleBarcode()` path for both camera and manual lookup.

## Key fixes
- Manual lookup button calls the same logic as camera scan.
- Scan rendering is wrapped in visible error handling, so if something breaks you see an error card instead of nothing.
- Lookup checks both Barcode and Tank ID.
- Barcode matching removes all non-letter/non-number characters and compares uppercase values.
- Existing tank lookup asks Apps Script directly before opening the new-tank form.
- The toast lives at the bottom of the layout instead of covering buttons.
- Saves are protected with an `isSaving` guard so scans cannot wipe an active form mid-save.
- Current status buttons are disabled in Search cards.

## Upload to GitHub Pages
Upload:
- `index.html`
- `style.css`
- `app.js`

## Apps Script
Paste:
- `apps_script.gs`

Then redeploy:
Deploy → Manage deployments → Edit → New version → Deploy

Keep the same Web App URL.


## v13 fix
- Replaced `let isSaving` with a defensive global `appBusy` state.
- Added `isBusy()` and `setBusy()` helpers so scan/add/update paths do not directly touch an uninitialized variable.
- Exposed key handlers on `window` for safer callback/debug behavior.


## v14 fix
- Camera scans are now buffered for 0.5 seconds.
- The app collects up to 5 reads at roughly 0.1 second intervals.
- It chooses the most repeated barcode; if tied, it uses the longest raw read to avoid partial barcode reads.

## v15 fix
- Added tap-to-focus support for phone browsers that expose camera focus controls.
- Tapping the camera preview shows a focus pulse and requests focus from the active video track.
- Browsers that block web camera focus controls now show a clear message instead of silently doing nothing.

## v16 fix
- Added a visible app version label in the header so phones can confirm they loaded the updated app.
- Added a large scan status panel under the camera for checking, found, new barcode, saved, and error states.
- Existing tank scans now show a prominent "Existing tank found" message with tank details instead of relying on the bottom toast.

## v17 fix
- Made the scan-in-progress state much more obvious with a full camera overlay that says not to rescan while lookup is running.
- Polished the scanner UI, status cards, buttons, tabs, and mobile spacing.
- Updated the checking/found/new/saved/error states so users can tell what happened without relying on the bottom toast.

## v18 fix
- Widened the barcode scan box so older phones do not need to get as close to fill the target.
- Request continuous camera focus automatically when the browser exposes it.
- Changed unsupported tap-focus messaging so users know the browser is handling focus automatically.
