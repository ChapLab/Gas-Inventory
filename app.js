const SHEET_NAME = "Tanks";
const HEADERS = ["Barcode", "Tank ID", "Gas", "Room", "Position", "Status", "Last Updated", "Updated By"];

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
    return outputResult(
      { ok: false, error: err.message },
      e.parameter.callback
    );
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

  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);

  return sheet;
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
        obj[header] = row[i] instanceof Date
          ? row[i].toISOString()
          : String(row[i] || "");
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

  sheet.getRange(row, HEADERS.indexOf("Status") + 1).setValue(status);
  sheet.getRange(row, HEADERS.indexOf("Last Updated") + 1).setValue(new Date());
  sheet.getRange(row, HEADERS.indexOf("Updated By") + 1).setValue(updatedBy || "");
}

function updateFull(barcode, tank) {
  if (!tank) throw new Error("Missing tank update.");

  barcode = normalizeBarcode(barcode);
  validateStatus(tank["Status"]);

  const sheet = getSheet();
  const row = findRowByBarcode(sheet, barcode);

  if (row < 0) throw new Error("Barcode not found: " + barcode);

  ["Room", "Position", "Status", "Updated By"].forEach(header => {
    sheet.getRange(row, HEADERS.indexOf(header) + 1).setValue(tank[header] || "");
  });

  sheet.getRange(row, HEADERS.indexOf("Last Updated") + 1).setValue(new Date());
}

function addTank(tank) {
  if (!tank) throw new Error("Missing tank object.");

  const barcode = normalizeBarcode(tank["Barcode"]);

  if (!barcode) throw new Error("Barcode is required.");
  if (!tank["Gas"]) throw new Error("Gas is required.");
  if (!tank["Room"]) throw new Error("Room is required.");
  if (!tank["Position"]) throw new Error("Position is required.");

  validateStatus(tank["Status"] || "New");

  const sheet = getSheet();

  if (findRowByBarcode(sheet, barcode) > 0) {
    throw new Error("That barcode already exists.");
  }

  const row = HEADERS.map(header => {
    if (header === "Barcode") return barcode;
    if (header === "Last Updated") return new Date();
    return tank[header] || "";
  });

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

function normalizeBarcode(value) {
  return String(value || "").trim();
}

function validateStatus(status) {
  const allowed = ["New", "In Use", "Empty"];

  if (!allowed.includes(status)) {
    throw new Error("Invalid status. Use New, In Use, or Empty.");
  }
}
