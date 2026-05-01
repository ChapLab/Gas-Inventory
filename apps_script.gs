const SHEET_NAME = "Tanks";
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
  "Updated By"
];

const LEGACY_HEADER_MAP = {
  "Location": "Position",
  "Last Updated": "Last Modified"
};

function doGet(e) {
  try {
    const action = e.parameter.action;
    const callback = e.parameter.callback;
    const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};

    let result;

    if (!action) {
      result = { ok: true, message: "Gas Tank Inventory API is running." };
    } else if (action === "list") {
      result = { ok: true, tanks: getTanks() };
    } else if (action === "updateStatus") {
      updateStatus(payload.barcode, payload.status, payload.updatedBy);
      result = { ok: true };
    } else if (action === "updateFull") {
      updateFull(payload.barcode, payload.tank);
      result = { ok: true };
    } else if (action === "addTank") {
      addTank(payload.tank);
      result = { ok: true };
    } else {
      result = { ok: false, error: "Unknown action: " + action };
    }

    return outputResult(result, callback);
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

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  migrateHeaders(sheet);
  return sheet;
}

function migrateHeaders(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
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

function getTanks() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  return values
    .filter(row => row.some(cell => String(cell).trim() !== ""))
    .map(row => {
      const obj = {};
      HEADERS.forEach((header, i) => {
        obj[header] = row[i] instanceof Date ? row[i].toISOString() : String(row[i] || "");
      });
      return obj;
    });
}

function updateStatus(barcode, status, updatedBy) {
  barcode = normalizeBarcode(barcode);
  validateStatus(status);

  const sheet = getSheet();
  const row = findRowByBarcode(sheet, barcode);

  if (row < 0) throw new Error("Barcode not found: " + barcode);

  const now = new Date();

  setCell(sheet, row, "Tank ID", barcode);
  setCell(sheet, row, "Status", status);
  setCell(sheet, row, "Last Modified", now);
  setCell(sheet, row, "Updated By", updatedBy || "");

  if (status === "In Use") {
    setCell(sheet, row, "Date Set In Use", now);
  }

  if (status === "Empty") {
    setCell(sheet, row, "Date Emptied", now);
  }
}

function updateFull(barcode, tank) {
  if (!tank) throw new Error("Missing tank update.");

  barcode = normalizeBarcode(barcode);
  validateStatus(tank["Status"]);

  const sheet = getSheet();
  const row = findRowByBarcode(sheet, barcode);

  if (row < 0) throw new Error("Barcode not found: " + barcode);

  const now = new Date();

  setCell(sheet, row, "Tank ID", barcode);
  setCell(sheet, row, "Gas", tank["Gas"] || getCell(sheet, row, "Gas"));
  setCell(sheet, row, "Room", tank["Room"] || "");
  setCell(sheet, row, "Position", tank["Position"] || "");
  setCell(sheet, row, "Status", tank["Status"] || "");
  setCell(sheet, row, "Updated By", tank["Updated By"] || "");
  setCell(sheet, row, "Last Modified", now);

  if (tank["Status"] === "In Use") {
    setCell(sheet, row, "Date Set In Use", now);
  }

  if (tank["Status"] === "Empty") {
    setCell(sheet, row, "Date Emptied", now);
  }
}

function addTank(tank) {
  if (!tank) throw new Error("Missing tank object.");

  const barcode = normalizeBarcode(tank["Barcode"]);

  if (!barcode) throw new Error("Barcode is required.");
  if (!tank["Gas"]) throw new Error("Gas is required.");
  if (!tank["Room"]) throw new Error("Room is required.");
  if (!tank["Position"]) throw new Error("Position is required.");

  const status = tank["Status"] || "New";
  validateStatus(status);

  const sheet = getSheet();

  if (findRowByBarcode(sheet, barcode) > 0) {
    throw new Error("That barcode already exists.");
  }

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
    "Updated By": tank["Updated By"] || ""
  };

  const row = HEADERS.map(header => rowObj[header] || "");
  sheet.appendRow(row);
}

function findRowByBarcode(sheet, barcode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;

  const barcodes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < barcodes.length; i++) {
    if (normalizeBarcode(barcodes[i][0]) === barcode) {
      return i + 2;
    }
  }

  return -1;
}

function setCell(sheet, row, header, value) {
  const col = HEADERS.indexOf(header) + 1;
  if (col < 1) throw new Error("Unknown header: " + header);
  sheet.getRange(row, col).setValue(value);
}

function getCell(sheet, row, header) {
  const col = HEADERS.indexOf(header) + 1;
  if (col < 1) throw new Error("Unknown header: " + header);
  return sheet.getRange(row, col).getValue();
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
