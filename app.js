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

function on(id, event, fn) {
  const node = el(id);
  if (node) node.addEventListener(event, fn);
}

function bindEvents() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });

  on("refreshBtn", "click", refreshData);
  on("saveScriptUrlBtn", "click", () => saveScriptUrl(el("scriptUrlInput").value));
  on("settingsSaveUrlBtn", "click", () => saveScriptUrl(el("settingsScriptUrlInput").value));
  on("saveDefaultUserBtn", "click", saveDefaultUser);

  on("searchInput", "input", renderResults);
  on("gasFilter", "change", renderResults);
  on("statusFilter", "change", renderResults);
  on("roomFilter", "change", renderResults);

  document.querySelectorAll(".quick-filters button").forEach(btn => {
    btn.addEventListener("click", () => {
      if (el("statusFilter")) el("statusFilter").value = btn.dataset.status;
      renderResults();
    });
  });

  on("startScanBtn", "click", startScanner);
  on("stopScanBtn", "click", stopScanner);
  on("manualLookupBtn", "click", () => handleBarcode(el("manualBarcodeInput").value.trim()));

  on("addTankBtn", "click", addTankFromForm);
  on("downloadCsvBtn", "click", downloadCsv);
}

function loadSettings() {
  const url = localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
  const user = localStorage.getItem(STORAGE_KEYS.defaultUser) || "";

  if (el("scriptUrlInput")) el("scriptUrlInput").value = url;
  if (el("settingsScriptUrlInput")) el("settingsScriptUrlInput").value = url;
  if (el("defaultUserInput")) el("defaultUserInput").value = user;
  if (el("addUpdatedBy")) el("addUpdatedBy").value = user;

  updateConnectionStatus();
}

function getScriptUrl() {
  return localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
}

function saveScriptUrl(url) {
  url = (url || "").trim();

  if (!url) {
    showToast("Paste the Apps Script Web App URL first.");
    return;
  }

  localStorage.setItem(STORAGE_KEYS.scriptUrl, url);

  if (el("scriptUrlInput")) el("scriptUrlInput").value = url;
  if (el("settingsScriptUrlInput")) el("settingsScriptUrlInput").value = url;

  updateConnectionStatus();
  refreshData();
  showToast("Connection saved.");
}

function saveDefaultUser() {
  const user = el("defaultUserInput").value.trim();
  localStorage.setItem(STORAGE_KEYS.defaultUser, user);

  if (el("addUpdatedBy")) el("addUpdatedBy").value = user;

  showToast("Initials saved.");
}

function getDefaultUser() {
  return localStorage.getItem(STORAGE_KEYS.defaultUser) || "";
}

function updateConnectionStatus(message = "") {
  const hasUrl = !!getScriptUrl();

  if (el("setupCard")) {
    el("setupCard").classList.toggle("hidden", hasUrl);
  }

  if (el("connectionStatus")) {
    el("connectionStatus").textContent = message || (hasUrl ? "Connected to Google Sheet" : "Paste Apps Script URL to connect");
  }
}

/* JSONP API. This avoids Google Apps Script CORS/fetch issues. */
function api(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = getScriptUrl();

    if (!url) {
      reject(new Error("Missing Apps Script URL."));
      return;
    }

    const callbackName = "jsonp_callback_" + Date.now() + "_" + Math.floor(Math.random() * 100000);

    const params = new URLSearchParams({
      action: action,
      callback: callbackName,
      payload: JSON.stringify(payload)
    });

    const script = document.createElement("script");

    window[callbackName] = function(data) {
      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }

      if (!data || !data.ok) {
        reject(new Error((data && data.error) || "Unknown Apps Script error."));
      } else {
        resolve(data);
      }
    };

    script.src = `${url}?${params.toString()}`;

    script.onerror = function() {
      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }

      reject(new Error("Connection failed. Make sure Apps Script is deployed as Web App with access set to Anyone."));
    };

    document.body.appendChild(script);
  });
}

async function refreshData() {
  if (!getScriptUrl()) {
    renderResults();
    return;
  }

  updateConnectionStatus("Refreshing...");

  try {
    const data = await api("list");
    tanks = data.tanks || [];
    updateConnectionStatus(`Loaded ${tanks.length} tanks`);
    populateFilters();
    renderResults();
  } catch (err) {
    updateConnectionStatus("Connection error");
    showToast(err.message);
  }
}

function populateFilters() {
  if (el("gasFilter")) fillSelect(el("gasFilter"), "All gases", uniqueValues("Gas"));
  if (el("roomFilter")) fillSelect(el("roomFilter"), "All rooms", uniqueValues("Room"));

  if (el("gasOptions")) fillDatalist(el("gasOptions"), uniqueValues("Gas"));
  if (el("roomOptions")) fillDatalist(el("roomOptions"), uniqueValues("Room"));
  if (el("positionOptions")) fillDatalist(el("positionOptions"), uniqueValues("Position"));
}

function uniqueValues(key) {
  return [...new Set(tanks.map(t => (t[key] || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, firstLabel, values) {
  const current = select.value;
  select.innerHTML = `<option value="">${firstLabel}</option>`;

  values.forEach(v => {
    const option = document.createElement("option");
    option.value = v;
    option.textContent = v;
    select.appendChild(option);
  });

  if (values.includes(current)) {
    select.value = current;
  }
}

function fillDatalist(list, values) {
  list.innerHTML = "";

  values.forEach(v => {
    const option = document.createElement("option");
    option.value = v;
    list.appendChild(option);
  });
}

function renderResults() {
  if (!el("tankResults")) return;

  const query = el("searchInput") ? el("searchInput").value.trim().toLowerCase() : "";
  const gas = el("gasFilter") ? el("gasFilter").value : "";
  const status = el("statusFilter") ? el("statusFilter").value : "";
  const room = el("roomFilter") ? el("roomFilter").value : "";

  const filtered = tanks.filter(t => {
    const haystack = [
      t["Barcode"],
      t["Tank ID"],
      t["Gas"],
      t["Room"],
      t["Position"],
      t["Status"],
      t["Updated By"]
    ].join(" ").toLowerCase();

    return (!query || haystack.includes(query)) &&
           (!gas || t["Gas"] === gas) &&
           (!status || t["Status"] === status) &&
           (!room || t["Room"] === room);
  });

  if (el("resultsSummary")) {
    el("resultsSummary").textContent = `${filtered.length} tank${filtered.length === 1 ? "" : "s"} found`;
  }

  el("tankResults").innerHTML = filtered.map(tankCardHtml).join("") || emptyState("No tanks match that search.");

  document.querySelectorAll("[data-update-barcode]").forEach(btn => {
    btn.addEventListener("click", () => {
      updateTankStatus(btn.dataset.updateBarcode, btn.dataset.status);
    });
  });
}

function tankCardHtml(t) {
  const statusClass = statusToClass(t["Status"]);

  return `
    <article class="tank-card">
      <div class="tank-top">
        <div>
          <div class="tank-title">${escapeHtml(t["Tank ID"] || "No tank ID")}</div>
          <div class="tank-detail"><b>${escapeHtml(t["Gas"] || "Unknown gas")}</b></div>
        </div>
        <span class="badge ${statusClass}">${escapeHtml(t["Status"] || "Unknown")}</span>
      </div>

      <div class="tank-detail">Room: <b>${escapeHtml(t["Room"] || "Not set")}</b></div>
      <div class="tank-detail">Position: <b>${escapeHtml(t["Position"] || "Not set")}</b></div>
      <div class="tank-detail">Barcode: ${escapeHtml(t["Barcode"] || "")}</div>
      <div class="tank-detail">Updated: ${escapeHtml(formatDate(t["Last Updated"]) || "Never")} ${t["Updated By"] ? "by " + escapeHtml(t["Updated By"]) : ""}</div>

      <div class="status-actions">
        <button data-update-barcode="${escapeAttr(t["Barcode"])}" data-status="New">New</button>
        <button data-update-barcode="${escapeAttr(t["Barcode"])}" data-status="In Use">In Use</button>
        <button data-update-barcode="${escapeAttr(t["Barcode"])}" data-status="Empty">Empty</button>
      </div>
    </article>
  `;
}

function statusToClass(status) {
  if (status === "In Use") return "InUse";
  if (status === "Empty") return "Empty";
  return "New";
}

async function updateTankStatus(barcode, status) {
  const updatedBy = getDefaultUser() || prompt("Your initials?") || "";

  try {
    await api("updateStatus", { barcode, status, updatedBy });
    showToast(`Marked ${status}.`);
    await refreshData();
  } catch (err) {
    showToast(err.message);
  }
}

function showView(viewId) {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewId);
  });

  document.querySelectorAll(".view").forEach(view => {
    view.classList.toggle("active", view.id === viewId);
  });
}

function startScanner() {
  if (!window.Html5QrcodeScanner) {
    showToast("Scanner library did not load. Check internet connection.");
    return;
  }

  if (!el("reader")) {
    showToast("Scanner area not found.");
    return;
  }

  el("reader").classList.remove("hidden");

  if (el("startScanBtn")) el("startScanBtn").classList.add("hidden");
  if (el("stopScanBtn")) el("stopScanBtn").classList.remove("hidden");

  scanner = new Html5QrcodeScanner("reader", {
    fps: 10,
    qrbox: { width: 260, height: 140 },
    rememberLastUsedCamera: true,
    supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.QR_CODE
    ]
  }, false);

  scanner.render(decodedText => {
    if (decodedText === lastScanned) return;

    lastScanned = decodedText;
    handleBarcode(decodedText);
    stopScanner();
  });
}

async function stopScanner() {
  if (scanner) {
    try {
      await scanner.clear();
    } catch (err) {
      console.warn(err);
    }

    scanner = null;
  }

  if (el("reader")) el("reader").classList.add("hidden");
  if (el("startScanBtn")) el("startScanBtn").classList.remove("hidden");
  if (el("stopScanBtn")) el("stopScanBtn").classList.add("hidden");
}

function handleBarcode(rawBarcode) {
  const barcode = String(rawBarcode || "").trim();

  if (!barcode) {
    showToast("No barcode entered.");
    return;
  }

  const found = tanks.find(t => String(t["Barcode"]).trim() === barcode);

  if (found) {
    renderKnownTankUpdate(found);
  } else {
    renderNewTankSetup(barcode);
  }
}

function renderKnownTankUpdate(t) {
  if (!el("scanResult")) return;

  el("scanResult").innerHTML = `
    <div class="card">
      <h2>Tank found: update it</h2>
      <p><b>${escapeHtml(t["Tank ID"] || "No tank ID")}</b> · ${escapeHtml(t["Gas"] || "Unknown gas")}</p>
      <p>Current: ${escapeHtml(t["Room"] || "No room")} · ${escapeHtml(t["Position"] || "No position")} · <b>${escapeHtml(t["Status"] || "No status")}</b></p>

      <label>Room</label>
      <input id="updateRoom" value="${escapeAttr(t["Room"] || "")}" list="roomOptions" placeholder="Example: Chem 401" />

      <label>Specific position</label>
      <input id="updatePosition" value="${escapeAttr(t["Position"] || "")}" list="positionOptions" placeholder="Example: Back wall rack" />

      <label>Status</label>
      <select id="updateStatus">
        <option ${t["Status"] === "New" ? "selected" : ""}>New</option>
        <option ${t["Status"] === "In Use" ? "selected" : ""}>In Use</option>
        <option ${t["Status"] === "Empty" ? "selected" : ""}>Empty</option>
      </select>

      <label>Updated by</label>
      <input id="updateUpdatedBy" value="${escapeAttr(getDefaultUser() || t["Updated By"] || "")}" placeholder="Your initials" />

      <div class="scan-actions">
        <button id="saveScannedUpdateBtn">Save update</button>
        <button id="scanAgainBtn" class="secondary">Scan another</button>
      </div>
    </div>
  `;

  on("saveScannedUpdateBtn", "click", async () => {
    const updatedBy = el("updateUpdatedBy").value.trim();

    if (updatedBy) {
      localStorage.setItem(STORAGE_KEYS.defaultUser, updatedBy);
      if (el("defaultUserInput")) el("defaultUserInput").value = updatedBy;
      if (el("addUpdatedBy")) el("addUpdatedBy").value = updatedBy;
    }

    try {
      await api("updateFull", {
        barcode: t["Barcode"],
        tank: {
          "Room": el("updateRoom").value.trim(),
          "Position": el("updatePosition").value.trim(),
          "Status": el("updateStatus").value,
          "Updated By": updatedBy
        }
      });

      showToast("Tank updated.");
      await refreshData();
      el("scanResult").innerHTML = emptyState("Saved. Scan another tank when ready.");
    } catch (err) {
      showToast(err.message);
    }
  });

  on("scanAgainBtn", "click", () => {
    el("scanResult").innerHTML = "";
    startScanner();
  });
}

function renderNewTankSetup(barcode) {
  if (!el("scanResult")) return;

  el("scanResult").innerHTML = `
    <div class="card warning">
      <h2>New tank detected</h2>
      <p>This barcode is not in the shared inventory yet. Set it up now.</p>

      <label>Barcode</label>
      <input id="newBarcode" value="${escapeAttr(barcode)}" readonly />

      <label>Tank ID / label</label>
      <input id="newTankId" placeholder="Example: Ar-001" />

      <label>Gas</label>
      <input id="newGas" list="gasOptions" placeholder="Example: Argon" />

      <label>Room</label>
      <input id="newRoom" list="roomOptions" placeholder="Example: Chem 401" />

      <label>Specific position</label>
      <input id="newPosition" list="positionOptions" placeholder="Example: Back wall rack" />

      <label>Status</label>
      <select id="newStatus">
        <option selected>New</option>
        <option>In Use</option>
        <option>Empty</option>
      </select>

      <label>Updated by</label>
      <input id="newUpdatedBy" value="${escapeAttr(getDefaultUser())}" placeholder="Your initials" />

      <div class="scan-actions">
        <button id="saveNewTankBtn">Add new tank</button>
        <button id="scanAgainBtn" class="secondary">Cancel / scan another</button>
      </div>
    </div>
  `;

  on("saveNewTankBtn", "click", async () => {
    const tank = {
      "Barcode": el("newBarcode").value.trim(),
      "Tank ID": el("newTankId").value.trim(),
      "Gas": el("newGas").value.trim(),
      "Room": el("newRoom").value.trim(),
      "Position": el("newPosition").value.trim(),
      "Status": el("newStatus").value,
      "Updated By": el("newUpdatedBy").value.trim()
    };

    if (!tank["Barcode"] || !tank["Gas"] || !tank["Room"] || !tank["Position"]) {
      showToast("Barcode, gas, room, and position are required.");
      return;
    }

    if (tank["Updated By"]) {
      localStorage.setItem(STORAGE_KEYS.defaultUser, tank["Updated By"]);
      if (el("defaultUserInput")) el("defaultUserInput").value = tank["Updated By"];
      if (el("addUpdatedBy")) el("addUpdatedBy").value = tank["Updated By"];
    }

    try {
      await api("addTank", { tank });
      showToast("New tank added.");
      await refreshData();
      el("scanResult").innerHTML = emptyState("Saved. Scan another tank when ready.");
    } catch (err) {
      showToast(err.message);
    }
  });

  on("scanAgainBtn", "click", () => {
    el("scanResult").innerHTML = "";
    startScanner();
  });
}

async function addTankFromForm() {
  const tank = {
    "Barcode": el("addBarcode").value.trim(),
    "Tank ID": el("addTankId").value.trim(),
    "Gas": el("addGas").value.trim(),
    "Room": el("addRoom").value.trim(),
    "Position": el("addPosition").value.trim(),
    "Status": el("addStatus").value,
    "Updated By": el("addUpdatedBy").value.trim() || getDefaultUser()
  };

  if (!tank["Barcode"] || !tank["Gas"] || !tank["Room"] || !tank["Position"]) {
    showToast("Barcode, gas, room, and position are required.");
    return;
  }

  if (tank["Updated By"]) {
    localStorage.setItem(STORAGE_KEYS.defaultUser, tank["Updated By"]);
    if (el("defaultUserInput")) el("defaultUserInput").value = tank["Updated By"];
  }

  try {
    await api("addTank", { tank });
    showToast("Tank added.");
    clearAddForm();
    await refreshData();
    showView("searchView");
  } catch (err) {
    showToast(err.message);
  }
}

function clearAddForm() {
  ["addBarcode", "addTankId", "addGas", "addRoom", "addPosition"].forEach(id => {
    if (el(id)) el(id).value = "";
  });

  if (el("addStatus")) el("addStatus").value = "New";
  if (el("addUpdatedBy")) el("addUpdatedBy").value = getDefaultUser();
}

function downloadCsv() {
  const headers = ["Barcode", "Tank ID", "Gas", "Room", "Position", "Status", "Last Updated", "Updated By"];
  const rows = tanks.map(t => headers.map(h => csvEscape(t[h] || "")).join(","));
  const csv = [headers.join(","), ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");

  a.href = URL.createObjectURL(blob);
  a.download = `gas-tank-inventory-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();

  URL.revokeObjectURL(a.href);
}

function csvEscape(value) {
  value = String(value);

  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}

function emptyState(message) {
  return `<div class="card"><p>${escapeHtml(message)}</p></div>`;
}

function showToast(message) {
  if (!el("toast")) {
    alert(message);
    return;
  }

  el("toast").textContent = message;
  el("toast").classList.remove("hidden");

  clearTimeout(window.toastTimeout);

  window.toastTimeout = setTimeout(() => {
    el("toast").classList.add("hidden");
  }, 3200);
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("`", "&#096;");
}
