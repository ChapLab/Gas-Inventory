const CURRENT_SHEET_NAME = "Tanks";
const OVERFLOW_SHEET_NAME = "Overflow";
const HEADERS = [
  "Barcode",
  "Tank ID",
  "Gas",
  "Room",
  "Position",
  "Status",
  "Date Added",
  "Date Set In Use",
  "Date Emptied",
  "Last Modified",
  "Updated By",
  "Event ID",
  "Event Type"
];

const LEGACY_HEADER_MAP = {
  "Location": "Position",
  "Last Updated": "Last Modified"
};

function doGet(e) {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const action = e.parameter.action;
      const callback = e.parameter.callback;
      const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};

      let result;

      if (!action) {
        result = { ok: true, message: "Gas Tank Inventory API is running." };
      } else if (action === "list") {
        result = { ok: true, tanks: getCurrentTanks() };
      } else if (action === "updateStatus") {
        appendStatusUpdate(payload.barcode, payload.status, payload.updatedBy);
        result = { ok: true };
      } else if (action === "updateFull") {
        appendFullUpdate(payload.barcode, payload.tank);
        result = { ok: true };
      } else if (action === "addTank") {
        appendNewTank(payload.tank);
        result = { ok: true };
      } else {
        result = { ok: false, error: "Unknown action: " + action };
      }

      return outputResult(result, callback);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return outputResult({ ok: false, error: err.message }, e.parameter.callback);
  }
}

function outputResult(result, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(name) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  ensureHeaders(sheet);
  return sheet;
}

function ensureHeaders(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const hasAnyHeader = existingHeaders.some(h => h.trim() !== "");

  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  const missing = HEADERS.some(h => !existingHeaders.includes(h));
  const hasLegacy = existingHeaders.some(h => LEGACY_HEADER_MAP[h]);

  if (missing || hasLegacy || existingHeaders.length !== HEADERS.length) {
    migrateSheetToHeaders(sheet, existingHeaders);
  } else {
    sheet.setFrozenRows(1);
  }
}

function migrateSheetToHeaders(sheet, existingHeaders) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const lastRow = sheet.getLastRow();
  const dataRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];

  const headerIndex = {};
  existingHeaders.forEach((h, i) => {
    const mapped = LEGACY_HEADER_MAP[h] || h;
    if (mapped && !(mapped in headerIndex)) headerIndex[mapped] = i;
  });

  const newRows = dataRows.map(row => HEADERS.map(header => headerIndex[header] !== undefined ? row[headerIndex[header]] : ""));

  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, HEADERS.length).setValues(newRows);
  }
}

function getAllEvents() {
  const current = readSheetRows(getOrCreateSheet(CURRENT_SHEET_NAME));
  const overflow = readSheetRows(getOrCreateSheet(OVERFLOW_SHEET_NAME));
  return current.concat(overflow).filter(row => normalizeBarcode(row["Barcode"]));
}

function readSheetRows(sheet) {
  ensureHeaders(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  return values
    .filter(row => row.some(cell => String(cell).trim() !== ""))
    .map(row => {
      const obj = {};
      HEADERS.forEach((header, i) => {
        obj[header] = row[i];
      });
      return obj;
    });
}

function getCurrentTanks() {
  const events = getAllEvents();
  const latest = latestByBarcode(events);
  rebuildSheetsFromEvents(events);
  return Object.values(latest).map(rowToClientObject);
}

function latestByBarcode(events) {
  const latest = {};

  events.forEach(row => {
    const barcode = normalizeBarcode(row["Barcode"]);
    if (!barcode) return;

    if (!row["Event ID"]) row["Event ID"] = Utilities.getUuid();
    if (!row["Tank ID"]) row["Tank ID"] = barcode;

    const candidateTime = eventTime(row);
    const existingTime = latest[barcode] ? eventTime(latest[barcode]) : -1;

    if (!latest[barcode] || candidateTime >= existingTime) {
      latest[barcode] = row;
    }
  });

  return latest;
}

function rebuildSheetsFromEvents(events) {
  const latest = latestByBarcode(events);
  const currentRows = [];
  const overflowRows = [];

  events.forEach(row => {
    const barcode = normalizeBarcode(row["Barcode"]);
    if (!barcode) return;

    const latestEventId = latest[barcode] && latest[barcode]["Event ID"];
    const isLatest = String(row["Event ID"]) === String(latestEventId);

    if (isLatest) currentRows.push(row);
    else overflowRows.push(row);
  });

  writeRows(getOrCreateSheet(CURRENT_SHEET_NAME), currentRows);
  writeRows(getOrCreateSheet(OVERFLOW_SHEET_NAME), overflowRows);
}

function writeRows(sheet, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);

  if (rows.length > 0) {
    const values = rows
      .sort((a, b) => eventTime(b) - eventTime(a))
      .map(row => HEADERS.map(header => row[header] || ""));
    sheet.getRange(2, 1, values.length, HEADERS.length).setValues(values);
  }
}

function appendEvent(rowObj) {
  const events = getAllEvents();
  events.push(rowObj);
  rebuildSheetsFromEvents(events);
}

function appendNewTank(tank) {
  if (!tank) throw new Error("Missing tank object.");

  const barcode = normalizeBarcode(tank["Barcode"]);
  if (!barcode) throw new Error("Barcode is required.");
  if (!tank["Gas"]) throw new Error("Gas is required.");
  if (!tank["Room"]) throw new Error("Room is required.");
  if (!tank["Position"]) throw new Error("Position is required.");

  const status = tank["Status"] || "New";
  validateStatus(status);

  const now = new Date();

  const rowObj = {
    "Barcode": barcode,
    "Tank ID": barcode,
    "Gas": tank["Gas"] || "",
    "Room": tank["Room"] || "",
    "Position": tank["Position"] || "",
    "Status": status,
    "Date Added": now,
    "Date Set In Use": status === "In Use" ? now : "",
    "Date Emptied": status === "Empty" ? now : "",
    "Last Modified": now,
    "Updated By": tank["Updated By"] || "",
    "Event ID": Utilities.getUuid(),
    "Event Type": "add"
  };

  appendEvent(rowObj);
}

function appendStatusUpdate(barcode, status, updatedBy) {
  barcode = normalizeBarcode(barcode);
  validateStatus(status);

  const current = latestByBarcode(getAllEvents())[barcode];
  if (!current) throw new Error("Barcode not found: " + barcode);

  const now = new Date();

  const rowObj = cloneRow(current);
  rowObj["Barcode"] = barcode;
  rowObj["Tank ID"] = barcode;
  rowObj["Status"] = status;
  rowObj["Last Modified"] = now;
  rowObj["Updated By"] = updatedBy || "";
  rowObj["Event ID"] = Utilities.getUuid();
  rowObj["Event Type"] = "status";

  if (status === "In Use") rowObj["Date Set In Use"] = now;
  if (status === "Empty") rowObj["Date Emptied"] = now;

  appendEvent(rowObj);
}

function appendFullUpdate(barcode, tank) {
  if (!tank) throw new Error("Missing tank update.");

  barcode = normalizeBarcode(barcode);
  validateStatus(tank["Status"]);

  const current = latestByBarcode(getAllEvents())[barcode];
  if (!current) throw new Error("Barcode not found: " + barcode);

  const now = new Date();

  const rowObj = cloneRow(current);
  rowObj["Barcode"] = barcode;
  rowObj["Tank ID"] = barcode;
  rowObj["Gas"] = tank["Gas"] || current["Gas"] || "";
  rowObj["Room"] = tank["Room"] || "";
  rowObj["Position"] = tank["Position"] || "";
  rowObj["Status"] = tank["Status"] || "";
  rowObj["Updated By"] = tank["Updated By"] || "";
  rowObj["Last Modified"] = now;
  rowObj["Event ID"] = Utilities.getUuid();
  rowObj["Event Type"] = "update";

  if (tank["Status"] === "In Use") rowObj["Date Set In Use"] = now;
  if (tank["Status"] === "Empty") rowObj["Date Emptied"] = now;

  appendEvent(rowObj);
}

function cloneRow(row) {
  const obj = {};
  HEADERS.forEach(h => obj[h] = row[h] || "");
  return obj;
}

function rowToClientObject(row) {
  const obj = {};
  HEADERS.forEach(header => {
    const value = row[header];
    obj[header] = value instanceof Date ? value.toISOString() : String(value || "");
  });
  return obj;
}

function eventTime(row) {
  const value = row["Last Modified"] || row["Date Added"];
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizeBarcode(value) {
  return String(value || "").trim();
}

function validateStatus(status) {
  const allowed = ["New", "In Use", "Empty"];
  if (!allowed.includes(status)) {
    throw new Error("Invalid status. Use New, In Use, or Empty.");
  }
}
