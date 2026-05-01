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
        result = { ok: true, tank: lookupTank(payload.barcode || payload.normalizedBarcode) };
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
    sheet.getRange("A:B").setNumberFormat("@");
    return;
  }

  const missing = HEADERS.some(h => !existingHeaders.includes(h));
  const hasLegacy = existingHeaders.some(h => LEGACY_HEADER_MAP[h]);

  if (missing || hasLegacy || existingHeaders.length !== HEADERS.length) {
    migrateSheetToHeaders(sheet, existingHeaders);
  } else {
    sheet.setFrozenRows(1);
    sheet.getRange("A:B").setNumberFormat("@");
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
  sheet.getRange("A:B").setNumberFormat("@");

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, HEADERS.length).setValues(newRows);
  }
}

function getCurrentTanks() {
  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const rows = readSheetRows(sheet).filter(row => normalizeBarcode(row["Barcode"]));

  const latestByCode = {};
  const duplicateRows = [];

  rows.forEach((row, idx) => {
    row.__rowNumber = idx + 2;
    const barcode = normalizeBarcode(row["Barcode"]);
    if (!row["Event ID"]) row["Event ID"] = Utilities.getUuid();
    if (!row["Tank ID"]) row["Tank ID"] = String(row["Barcode"] || "");

    if (!latestByCode[barcode] || eventTime(row) >= eventTime(latestByCode[barcode])) {
      if (latestByCode[barcode]) duplicateRows.push(latestByCode[barcode].__rowNumber);
      latestByCode[barcode] = row;
    } else {
      duplicateRows.push(row.__rowNumber);
    }
  });

  if (duplicateRows.length > 0) moveRowsToOverflow(sheet, duplicateRows);

  return Object.values(latestByCode).map(rowToClientObject);
}

function lookupTank(barcode) {
  const target = normalizeBarcode(barcode);
  if (!target) throw new Error("Barcode is required.");

  const rows = readSheetRows(getOrCreateSheet(CURRENT_SHEET_NAME))
    .concat(readSheetRows(getOrCreateSheet(OVERFLOW_SHEET_NAME)));

  const matches = rows.filter(row => {
    return normalizeBarcode(row["Barcode"]) === target ||
           normalizeBarcode(row["Tank ID"]) === target;
  });

  if (matches.length === 0) return null;

  let latest = matches[0];
  matches.forEach(row => {
    if (eventTime(row) >= eventTime(latest)) latest = row;
  });

  return rowToClientObject(latest);
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

  const barcode = String(tank["Barcode"] || "").trim();
  const normalized = normalizeBarcode(barcode);

  if (!normalized) throw new Error("Barcode is required.");
  if (!tank["Gas"]) throw new Error("Gas is required.");
  if (!tank["Room"]) throw new Error("Room is required.");
  if (!tank["Position"]) throw new Error("Position is required.");

  const status = tank["Status"] || "New";
  validateStatus(status);

  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const existingRow = findRowByBarcode(sheet, normalized);
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

  sheet.appendRow(rowToArray(rowObj));
  if (existingRow > 0) moveRowsToOverflow(sheet, [existingRow]);
}

function fastStatusUpdate(barcode, status, updatedBy) {
  const normalized = normalizeBarcode(barcode);
  validateStatus(status);

  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const existingRow = findRowByBarcode(sheet, normalized);
  if (existingRow < 0) throw new Error("Barcode not found: " + barcode);

  const current = getRowObject(sheet, existingRow);
  const now = new Date();

  const rowObj = cloneRow(current);
  rowObj["Barcode"] = String(current["Barcode"] || barcode);
  rowObj["Tank ID"] = String(current["Barcode"] || barcode);
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

  const normalized = normalizeBarcode(barcode);
  validateStatus(tank["Status"]);

  const sheet = getOrCreateSheet(CURRENT_SHEET_NAME);
  const existingRow = findRowByBarcode(sheet, normalized);
  if (existingRow < 0) throw new Error("Barcode not found: " + barcode);

  const current = getRowObject(sheet, existingRow);
  const now = new Date();

  const rowObj = cloneRow(current);
  rowObj["Barcode"] = String(current["Barcode"] || barcode);
  rowObj["Tank ID"] = String(current["Barcode"] || barcode);
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

function findRowByBarcode(sheet, normalizedBarcode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();

  for (let i = 0; i < values.length; i++) {
    const barcode = normalizeBarcode(values[i][0]);
    const tankId = normalizeBarcode(values[i][1]);
    if (barcode === normalizedBarcode || tankId === normalizedBarcode) return i + 2;
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
  return String(value || "").trim().replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function validateStatus(status) {
  const allowed = ["New", "In Use", "Empty"];
  if (!allowed.includes(status)) throw new Error("Invalid status. Use New, In Use, or Empty.");
}
