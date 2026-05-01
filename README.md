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
