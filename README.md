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


## v16 changes
- Live camera ROI is half the previous dimensions: 25% width and 10% height of the camera view.
- Added photo barcode mode: take/upload a picture, pinch to zoom/pan/rotate into the ROI, then scan from the adjusted photo.
- Photo mode scans a buffered crop around the ROI, so the visible box is smaller than the actual image area checked.


## v17 fix
- Photo scan no longer only scans the tiny ROI.
- It scans the full preview, a wide buffered crop, and contrast-enhanced/rotated versions.
- This fixes the common `No MultiFormat Readers were able to detect the code` error caused by over-cropping or low contrast.


## v18 photo-mode fixes
- Photo appears immediately after loading without needing Reset.
- Zoom is smoother and clamped more naturally.
- You can zoom back out below the initial fit instead of getting stuck.
- Photo scanning uses the displayed adjusted image plus larger buffered crops and contrast/rotation attempts.
