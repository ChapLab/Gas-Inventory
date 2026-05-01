# ChapLab Gas Tank Inventory v7

Fixes:
- Toast/message box now has its own sticky bottom area inside the page layout, so it no longer covers buttons.
- Barcode comparison is normalized in both app and Apps Script.
- Before deciding whether a scan is new or existing, the app refreshes the tank list from the sheet.
- This helps when another person added the tank earlier or when local data is stale.
- Existing tank scans show "Existing tank found" instead of opening the new tank form.
- Apps Script formats Barcode and Tank ID columns as plain text to reduce barcode mismatch issues.

Important note:
If your old sheet stored barcodes as numbers and stripped leading zeros, the app cannot recover those lost zeros automatically. You may need to manually correct those existing barcode cells once.


## v8 changes
- Faster Apps Script updates: no full-sheet reconstruction on every write.
- On add/update, the new row is appended to `Tanks`, then the previous row for that barcode is moved to `Overflow`.
- Uses a lock so simultaneous requests queue safely.
- App uses an `isSaving` guard so a new scan cannot wipe an in-progress add/update form.
- The app does not force a full refresh after every successful save, so the form is not kicked out while saving.


## v9 changes
- Scanning now calls `lookup` in Apps Script before deciding a barcode is new.
- `lookup` checks both `Tanks` and `Overflow` and returns the latest event for that barcode.
- Barcode matching now ignores spaces, hyphens, underscores, and periods.
