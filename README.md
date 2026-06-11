# ChapLab Gas Tank Inventory

ChapLab Gas Tank Inventory is a mobile-friendly web app for tracking laboratory gas cylinders by barcode. It lets lab members scan or manually enter a tank barcode, look up the current tank record, add new tanks, update gas, room, position, status, and user initials, and keep the active inventory synchronized with a Google Sheet through Google Apps Script.

The app is designed for phone-first use around gas cylinder storage areas, instrument rooms, and shared lab spaces where quick barcode scanning and simple status updates matter more than a heavy database interface.

**Live app:** [https://chaplab.github.io/Gas-Inventory/](https://chaplab.github.io/Gas-Inventory/)

> Keywords: `gas tank inventory`, `gas cylinder inventory`, `lab inventory`, `laboratory inventory`, `barcode scanner`, `barcode lookup`, `mobile web app`, `Google Sheets`, `Google Apps Script`, `GitHub Pages`, `html5-qrcode`, `QR code scanner`, `cylinder tracking`, `tank tracking`, `gas tracking`, `room tracking`, `position tracking`, `inventory status`, `New`, `In Use`, `Empty`, `audit history`, `overflow sheet`, `JSONP API`, `Chapman Lab`, `ChapLab`, `scientific lab management`, `chemical inventory`, `Python-free web app`, `JavaScript`, `HTML`, `CSS`

## Data Storage And Access

All inventory data is stored in the connected Google Sheet. The GitHub repository and GitHub Pages site contain only the web app code: `index.html`, `style.css`, `app.js`, and the Apps Script source. They do not store the tank inventory database.

Access to tank records is controlled by the Google Sheet and Google Apps Script deployment permissions. Users who do not have access to the connected Sheet or the deployed Apps Script Web App cannot view, search, add, or update the inventory through this app.

For private lab inventory use, restrict the Google Sheet and Apps Script Web App to the intended lab members or organization accounts. Do not deploy the Apps Script Web App with public `Anyone` access if the inventory should remain private.

## What It Does

The inventory app provides a lightweight front end for a Google Sheet-based gas tank database. Users can scan a tank barcode with a phone camera, search the loaded inventory, add a new tank, update tank metadata, or mark a tank as `New`, `In Use`, or `Empty`.

The active sheet stores the current record for each barcode. Older records are moved into an overflow sheet so the current inventory stays clean while historical updates remain available. No inventory records are stored in this GitHub repository.

## Features

- Phone-friendly barcode scanning with `html5-qrcode`.
- Manual barcode lookup for damaged labels, camera issues, or desktop use.
- Shared lookup path for scanned and manually entered barcodes.
- Barcode matching that ignores punctuation, spaces, and capitalization.
- Fast phone-side lookup from the loaded inventory.
- Background Apps Script refresh for matched tanks.
- New-tank setup when an unknown barcode is scanned.
- Search by gas, room, status, barcode, tank ID, and free-text terms.
- Quick filters for all tanks, new tanks, in-use tanks, and empty tanks.
- Editable tank cards for current gas, room, position, and status.
- Duplicate active-barcode detection and visible conflict warnings.
- Local CSV backup download from the browser.
- Persistent settings for the Apps Script URL and default user initials.
- Current and overflow sheet model for active records plus historical events.
- Mobile scanning improvements including buffered reads, a smaller scan box for older phones, visible scan states, and camera focus messaging.

## Repository Structure

```text
Gas-Inventory/
  README.md
  index.html        # Static web app shell
  style.css         # Mobile-first UI styling
  app.js            # Browser app, scanner, search, forms, Apps Script API calls
  apps_script.gs    # Google Apps Script backend for the connected Sheet
```

## Technology

- Static HTML, CSS, and JavaScript frontend.
- `html5-qrcode` loaded from a CDN for camera scanning.
- Google Apps Script backend deployed as a Web App.
- Google Sheets as the only persistent storage layer for tank inventory records.
- GitHub Pages-compatible deployment for the frontend code only.

## Sheet Model

The Apps Script backend uses two tabs in the connected Google Sheet:

| Sheet | Purpose |
| --- | --- |
| `Tanks` | Current active row for each tank barcode. |
| `Overflow` | Older rows moved out of the active inventory when a tank is updated. |

Expected headers:

```text
Barcode | Tank ID | Gas | Room | Position | Status | Date Added | Date Set In Use | Date Emptied | Last Modified | Updated By | Event ID | Event Type
```

The script can migrate legacy headers such as `Location` to `Position` and `Last Updated` to `Last Modified`.

## Deployment

### 1. Upload Frontend Files To GitHub Pages

Publish these files from the repository root:

```text
index.html
style.css
app.js
```

If using GitHub Pages, enable Pages for the repository and serve from the branch/folder that contains these files. GitHub Pages hosts the app interface only; it does not host or expose the inventory data.

### 2. Create The Google Sheet

Create a Google Sheet for the tank inventory. This Sheet is the inventory database. The Apps Script will create or repair the required `Tanks` and `Overflow` tabs and headers when it runs.

Share the Sheet only with users who should be allowed to see or manage the inventory.

### 3. Add Apps Script Backend

In the Google Sheet, open Apps Script and paste the contents of:

```text
apps_script.gs
```

You can open Apps Script from the Sheet by choosing:

```text
Extensions -> Apps Script
```

If the Apps Script editor opens with a default `Code.gs` file, replace its contents with the contents of `apps_script.gs` from this repository. Save the project.

### 4. Deploy Apps Script And Copy The Link

In the Apps Script editor, create a Web App deployment:

```text
Deploy -> New deployment -> Select type -> Web app
```

Use these deployment settings:

| Setting | Recommended value |
| --- | --- |
| Description | `Gas Tank Inventory API` or similar |
| Execute as | `Me` |
| Who has access | Your lab, organization, or intended users |

Click **Deploy**. Google may ask you to authorize the script the first time. After deployment, Apps Script shows a **Web app URL**. This is the `script.google.com` link to paste into the Tank Inventory app.

The URL usually looks like this:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Copy the `/exec` Web App URL, not the Apps Script editor URL. The editor URL usually starts with `https://script.google.com/home/projects/...` and will not work as the app connection URL.

### 5. Redeploy After Script Changes

If you edit `apps_script.gs`, redeploy the Web App so the live endpoint uses the new code:

```text
Deploy -> Manage deployments -> Edit -> New version -> Deploy
```

Keep the same Web App URL when redeploying after script changes. For private inventory use, set the Web App access permissions so only authorized users can run it. Do not choose public `Anyone` access unless the inventory is intended to be public.

### 6. Connect The Web App

Open the deployed inventory app, paste the Google Apps Script Web App URL into the setup card or Settings tab, and click **Save connection**.

The app stores the URL in browser local storage on that device. The URL is a connection setting, not a copy of the inventory database.

## Basic Workflow

1. Open the web app on a phone or desktop browser.
2. Save the Google Apps Script Web App URL in Settings.
3. Click **Refresh** to load current tank records from the connected Google Sheet.
4. Use **Scan** to scan a tank barcode, or enter the barcode manually.
5. If the tank exists, review or update its gas, room, position, status, and updater initials.
6. If the barcode is new, fill in the tank details and add it.
7. Use **Search** to filter tanks by gas, room, status, barcode, or text.
8. Use **Download local CSV backup** from Settings when a quick browser-side export is needed.

## Status Values

| Status | Meaning |
| --- | --- |
| `New` | Tank is present and not yet set in use. |
| `In Use` | Tank is currently connected or being used. |
| `Empty` | Tank is empty and ready for return, replacement, or removal. |

Status updates set the relevant date fields automatically where applicable.

## Apps Script API Actions

The frontend talks to the Apps Script Web App with JSONP requests. The Apps Script reads from and writes to the connected Google Sheet; the frontend does not maintain a separate server-side database.

Supported actions include:

| Action | Purpose |
| --- | --- |
| `list` | Return current tanks from the `Tanks` sheet. |
| `lookup` | Find the latest matching tank by barcode or tank ID. |
| `addTank` | Add a new active tank unless an active duplicate already exists. |
| `updateStatus` | Append a status update and move the previous active row to `Overflow`. |
| `updateFull` | Append a full metadata update and move the previous active row to `Overflow`. |

## Troubleshooting

**The app says setup is needed.**
Paste the deployed Google Apps Script Web App URL into the setup card or Settings page. The URL should look like `https://script.google.com/macros/s/.../exec`.

**Where do I get the `script.google.com` link?**
Open the inventory Google Sheet, go to **Extensions -> Apps Script**, deploy the script as a **Web app**, then copy the **Web app URL** shown after deployment.

**My `script.google.com` link does not work.**
Make sure you copied the Web App URL ending in `/exec`, not the Apps Script editor URL. Also confirm the deployment was updated after the latest script changes.

**Someone cannot see the inventory.**
Confirm that they have permission to access both the Google Sheet and the Apps Script Web App deployment. The app cannot show tank records to users who are not authorized for the connected Google resources.

**You need to keep tank data private.**
Restrict the Google Sheet sharing settings and Apps Script Web App access to the intended lab members or organization. Avoid public `Anyone` deployment settings.

**Scans do not work on a phone.**
Use HTTPS, allow camera permissions, and try the browser's rear camera. Some browsers manage focus automatically and do not expose manual tap-to-focus controls.

**A barcode is found manually but not by camera.**
Try moving the phone farther from the label. The app buffers multiple reads and chooses the most repeated or longest read, but partial scans can still happen on old phones or damaged labels.

**A tank appears as a duplicate conflict.**
More than one active row appears to share the same barcode. Open the Google Sheet and decide which row is the true current record.

**Updates are not reaching the Sheet.**
Confirm the Apps Script deployment is current, the Web App URL is unchanged, and the deployment allows the intended users to access it.

## Changelog Highlights

- v12: Unified scan and manual lookup through one `handleBarcode()` path.
- v13: Replaced fragile save state with defensive global busy-state helpers.
- v14: Added buffered camera reads to reduce partial barcode scans.
- v15: Added tap-to-focus support where browsers expose camera focus controls.
- v16: Added visible app version and prominent scan status states.
- v17: Added scan-in-progress overlay and polished mobile scanner UI.
- v18: Widened the scan box and improved camera focus messaging.
- v19: Existing tanks open immediately from phone-side inventory, with background refresh.
- v20: Duplicate new-tank saves return the existing tank and active duplicate conflicts are flagged.
- v21: Reduced the scan box so older phones can read tank barcodes from farther back before autofocus kicks in.
- v22: Tightened the scan box further for phones that still focus too close to tank labels.

## License

No license file is currently included in this repository. Add a license before distributing or reusing the code outside the project.
