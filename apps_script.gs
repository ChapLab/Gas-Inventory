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
    lock.waitLock(10000);

    try {
      const action = e.parameter.action;
      const callback = e.parameter.callback;
      const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};

      let result;

      if (!action) {
        result = { ok: true, message: "Gas Tank Inventory API is running." };
      } else if (action === "list") {
        result = { ok: true, tanks: getCurrentTanks() };
      } else if (action === "lookup") {
        result = { ok: true, tank: lookupTank(payload.barcode) };
      } else if (action === "updateStatus") {
        fastStatusUpdate(payload.barcode, payload.status, payload.updatedBy);
        result = { ok: true };
      } else if (action === "updateFull") {
        fastFullUpdate(payload.barcode, payload.tank);
        result = { ok: true };
      } else if (action === "addTank") {
        fastAddTank(payload.tank);
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


function lookupTank(barcode) {
  barcode = normalizeBarcode(barcode);
  if (!barcode) throw new Error("Barcode is required.");

  const currentRows = readSheetRows(getOrCreateSheet(CURRENT_SHEET_NAME));
  const overflowRows = readSheetRows(getOrCreateSheet(OVERFLOW_SHEET_NAME));
  const matching = currentRows
    .concat(overflowRows)
    .filter(row => normalizeBarcode(row["Barcode"]) === barcode);

  if (matching.length === 0) return null;

  let latest = matching[0];
  matching.forEach(row => {
    if (eventTime(row) >= eventTime(latest)) latest = row;
  });

  return rowToClientObject(latest);
}

function getCurrentTanks() {
  const currentSheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const rows = readSheetRows(currentSheet).filter(row => normalizeBarcode(row["Barcode"]));

  // Safety pass only for the current sheet. If duplicates somehow exist, keep latest in Tanks and move older to Overflow.
  const byBarcode = {};
  const duplicates = [];

  rows.forEach((row, idx) => {
    const barcode = normalizeBarcode(row["Barcode"]);
    row.__rowNumber = idx + 2;

    if (!row["Event ID"]) row["Event ID"] = Utilities.getUuid();
    if (!row["Tank ID"]) row["Tank ID"] = barcode;

    if (!byBarcode[barcode] || eventTime(row) >= eventTime(byBarcode[barcode])) {
      if (byBarcode[barcode]) duplicates.push(byBarcode[barcode]);
      byBarcode[barcode] = row;
    } else {
      duplicates.push(row);
    }
  });

  if (duplicates.length > 0) {
    moveRowsToOverflow(currentSheet, duplicates.map(r => r.__rowNumber));
  }

  return Object.values(byBarcode).map(rowToClientObject);
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
      HEADERS.forEach((header, i) => obj[header] = row[i]);
      return obj;
    });
}

function fastAddTank(tank) {
  if (!tank) throw new Error("Missing tank object.");

  const barcode = normalizeBarcode(tank["Barcode"]);
  if (!barcode) throw new Error("Barcode is required.");
  if (!tank["Gas"]) throw new Error("Gas is required.");
  if (!tank["Room"]) throw new Error("Room is required.");
  if (!tank["Position"]) throw new Error("Position is required.");

  const status = tank["Status"] || "New";
  validateStatus(status);

  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const existingRow = findRowByBarcode(sheet, barcode);
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
    "Event Type": existingRow > 0 ? "add-replaced-existing" : "add"
  };

  // Fast path: append new current row, then move the old row to Overflow.
  sheet.appendRow(rowToArray(rowObj));
  if (existingRow > 0) moveRowsToOverflow(sheet, [existingRow]);
}

function fastStatusUpdate(barcode, status, updatedBy) {
  barcode = normalizeBarcode(barcode);
  validateStatus(status);

  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const existingRow = findRowByBarcode(sheet, barcode);
  if (existingRow < 0) throw new Error("Barcode not found: " + barcode);

  const current = getRowObject(sheet, existingRow);
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

  sheet.appendRow(rowToArray(rowObj));
  moveRowsToOverflow(sheet, [existingRow]);
}

function fastFullUpdate(barcode, tank) {
  if (!tank) throw new Error("Missing tank update.");

  barcode = normalizeBarcode(barcode);
  validateStatus(tank["Status"]);

  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const existingRow = findRowByBarcode(sheet, barcode);
  if (existingRow < 0) throw new Error("Barcode not found: " + barcode);

  const current = getRowObject(sheet, existingRow);
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

  sheet.appendRow(rowToArray(rowObj));
  moveRowsToOverflow(sheet, [existingRow]);
}

function moveRowsToOverflow(currentSheet, rowNumbers) {
  const overflow = getOrCreateSheet(OVERFLOW_SHEET_NAME);
  const uniqueRows = [...new Set(rowNumbers)].filter(n => n > 1).sort((a, b) => b - a);

  uniqueRows.forEach(rowNumber => {
    const values = currentSheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
    overflow.appendRow(values);
    currentSheet.deleteRow(rowNumber);
  });
}

function findRowByBarcode(sheet, barcode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const barcodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < barcodes.length; i++) {
    if (normalizeBarcode(barcodes[i][0]) === barcode) return i + 2;
  }

  return -1;
}

function getRowObject(sheet, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  const obj = {};
  HEADERS.forEach((header, i) => obj[header] = values[i]);
  return obj;
}

function rowToArray(rowObj) {
  return HEADERS.map(header => rowObj[header] || "");
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
  return String(value || "").trim().replace(/[\s\-_.]/g, "");
}

function validateStatus(status) {
  const allowed = ["New", "In Use", "Empty"];
  if (!allowed.includes(status)) throw new Error("Invalid status. Use New, In Use, or Empty.");
}
