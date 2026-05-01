# ChapLab Gas Tank Inventory v4

Fixes:
- Standardizes the sheet and app to `Position` instead of mixing Location/Position.
- Tank ID is always the barcode number.
- Gas, Room, and Position fields are textboxes with dropdown suggestions from the Google Sheet.
- Position suggestions are filtered by the selected Room.
- Scanner stays open after a scan, so the browser should not ask for camera permission for every tank. Tap Stop Scanner when done.
- Tracks Date Added, Date Set In Use, Date Emptied, Last Modified.

Upload to GitHub Pages:
- index.html
- style.css
- app.js

Paste into Apps Script:
- apps_script.gs

Then redeploy:
Deploy → Manage deployments → Edit → New version → Deploy
