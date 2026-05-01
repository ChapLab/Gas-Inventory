const STORAGE_KEYS = {
  scriptUrl: "gasTankScriptUrl",
  defaultUser: "gasTankDefaultUser"
};

let tanks = [];
let scanner = null;
let lastScanned = "";

const el = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadSettings();
  refreshData();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  el("refreshBtn").addEventListener("click", refreshData);
  el("saveScriptUrlBtn").addEventListener("click", () => saveScriptUrl(el("scriptUrlInput").value));
  el("settingsSaveUrlBtn").addEventListener("click", () => saveScriptUrl(el("settingsScriptUrlInput").value));
  el("saveDefaultUserBtn").addEventListener("click", saveDefaultUser);

  el("searchInput").addEventListener("input", renderResults);
  el("gasFilter").addEventListener("change", renderResults);
  el("statusFilter").addEventListener("change", renderResults);
  el("roomFilter").addEventListener("change", renderResults);

  el("startScanBtn").addEventListener("click", startScanner);
  el("stopScanBtn").addEventListener("click", stopScanner);
  el("manualLookupBtn").addEventListener("click", () => handleBarcode(el("manualBarcodeInput").value.trim()));

  el("addTankBtn").addEventListener("click", addTankFromForm);
}

function loadSettings() {
  const url = localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
  const user = localStorage.getItem(STORAGE_KEYS.defaultUser) || "";

  el("scriptUrlInput").value = url;
  el("settingsScriptUrlInput").value = url;
  el("defaultUserInput").value = user;
  el("addUpdatedBy").value = user;
}

function getScriptUrl() {
  return localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
}

function saveScriptUrl(url) {
  url = url.trim();
  if (!url) return alert("Paste your Apps Script URL");

  localStorage.setItem(STORAGE_KEYS.scriptUrl, url);
  refreshData();
}

function saveDefaultUser() {
  const user = el("defaultUserInput").value.trim();
  localStorage.setItem(STORAGE_KEYS.defaultUser, user);
}

function getDefaultUser() {
  return localStorage.getItem(STORAGE_KEYS.defaultUser) || "";
}

async function api(action, payload = {}) {
  const url = getScriptUrl();
  if (!url) throw new Error("Missing Apps Script URL.");

  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify({ action, ...payload })
  });

  const text = await response.text();
  return JSON.parse(text);
}

async function refreshData() {
  if (!getScriptUrl()) return;

  try {
    const data = await api("list");
    tanks = data.tanks || [];
    renderResults();
  } catch (err) {
    alert("Connection error: " + err.message);
  }
}

function renderResults() {
  const container = el("tankResults");
  if (!container) return;

  container.innerHTML = tanks.map(t => `
    <div>
      <b>${t["Tank ID"]}</b> (${t["Gas"]})<br>
      ${t["Room"]} - ${t["Position"]}<br>
      Status: ${t["Status"]}
    </div>
  `).join("");
}

async function updateTank(barcode, updates) {
  await api("updateFull", {
    barcode,
    tank: updates
  });
  refreshData();
}

function handleBarcode(barcode) {
  const found = tanks.find(t => t["Barcode"] === barcode);

  if (found) {
    el("scanResult").innerHTML = `
      <h3>Update Tank</h3>
      <input id="uRoom" value="${found["Room"]}">
      <input id="uPos" value="${found["Position"]}">
      <select id="uStatus">
        <option>New</option>
        <option>In Use</option>
        <option>Empty</option>
      </select>
      <button onclick="saveUpdate('${barcode}')">Save</button>
    `;
  } else {
    el("scanResult").innerHTML = `
      <h3>New Tank</h3>
      <input id="nGas" placeholder="Gas">
      <input id="nRoom" placeholder="Room">
      <input id="nPos" placeholder="Position">
      <button onclick="saveNew('${barcode}')">Add</button>
    `;
  }
}

async function saveUpdate(barcode) {
  await updateTank(barcode, {
    Room: el("uRoom").value,
    Position: el("uPos").value,
    Status: el("uStatus").value,
    "Updated By": getDefaultUser()
  });
}

async function saveNew(barcode) {
  await api("addTank", {
    tank: {
      Barcode: barcode,
      Gas: el("nGas").value,
      Room: el("nRoom").value,
      Position: el("nPos").value,
      Status: "New",
      "Updated By": getDefaultUser()
    }
  });
  refreshData();
}

function startScanner() {
  const reader = document.getElementById("reader");
  reader.innerHTML = "";

  scanner = new Html5Qrcode("reader");
  scanner.start(
    { facingMode: "environment" },
    { fps: 10 },
    decoded => {
      handleBarcode(decoded);
      stopScanner();
    }
  );
}

function stopScanner() {
  if (scanner) {
    scanner.stop();
    scanner = null;
  }
}
