# ChapLab Gas Tank Inventory v6

Fixes and changes:
- Backend is append-only. Every add/update creates a new event row first.
- The app shows only the latest event per barcode.
- Older events are moved to the `Overflow` tab instead of being deleted.
- Uses a script lock to prevent two simultaneous updates from corrupting the sheet.
- Current status button is disabled/grayed out in Search cards.
- Scanner gives a clearer success message and scrolls to the form after scanning.
- After Add/Save, the app scrolls back to the camera card.
- Room typing no longer steals focus on every character.
- Scanner attempts continuous autofocus through browser constraints, but true tap-to-focus is not reliably exposed by mobile browsers.

Upload to GitHub Pages:
- index.html
- style.css
- app.js

Paste into Apps Script:
- apps_script.gs

Then redeploy Apps Script:
Deploy → Manage deployments → Edit → New version → Deploy

Sheet tabs:
- Tanks = latest row per barcode only
- Overflow = older event rows
