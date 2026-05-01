# ChapLab Gas Tank Inventory App v3

Changes:
- Tank ID is automatically the barcode number.
- Room and Location are text boxes with dropdown suggestions.
- Location suggestions are filtered by the selected room.
- Dates are tracked separately: Date Added, Date Set In Use, Date Emptied, Last Modified.
- New tanks appear locally right away while saving to the sheet.

Upload index.html, style.css, and app.js to GitHub Pages.
Paste apps_script.gs into Apps Script, then redeploy as a new version.

Sheet tab: Tanks

Headers:
Barcode | Tank ID | Gas | Room | Location | Status | Date Added | Date Set In Use | Date Emptied | Last Modified | Updated By

Legacy Position migrates to Location. Legacy Last Updated migrates to Last Modified.
