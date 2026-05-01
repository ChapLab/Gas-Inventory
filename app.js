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

  document.querySelectorAll(".quick-filters button").forEach(btn => {
    btn.addEventListener("click", () => {
      el("statusFilter").value = btn.dataset.status;
      renderResults();
    });
  });

  el("startScanBtn").addEventListener("click", startScanner);
  el("stopScanBtn").addEventListener("click", stopScanner);
  el("manualLookupBtn").addEventListener("click", () => handleBarcode(el("manualBarcodeInput").value.trim()));

  el("addTankBtn").addEventListener("click", addTankFromForm);
  el("downloadCsvBtn").addEventListener("click", downloadCsv);
}

function loadSettings() {
  const url = localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
  const user = localStorage.getItem(STORAGE_KEYS.defaultUser) || "";

  el("scriptUrlInput").value = url;
  el("settingsScriptUrlInput").value = url;
  el("defaultUserInput").value = user;
  el("addUpdatedBy").value = user;

  updateConnectionStatus();
}

function getScriptUrl() {
  return localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
}

function saveScriptUrl(url) {
  url = url.trim();
  if (!url) {
    showToast("Paste the Apps Script Web App URL first.");
    return;
  }
  localStorage.setItem(STORAGE_KEYS.scriptUrl, url);
  el("scriptUrlInput").value = url;
  el("settingsScriptUrlInput").value = url;
  updateConnectionStatus();
  refreshData();
  showToast("Connection saved.");
}

function saveDefaultUser() {
  const user = el("defaultUserInput").value.trim();
  localStorage.setItem(STORAGE_KEYS.defaultUser, user);
  el("addUpdatedBy").value = user;
  showToast("Initials saved.");
}

function updateConnectionStatus(message = "") {
  const hasUrl = !!getScriptUrl();
  el("setupCard").classList.toggle("hidden", hasUrl);
  el("connectionStatus").textContent = message || (hasUrl ? "Connected to Google Sheet" : "Paste Apps Script URL to connect");
}

async function api(action, payload = {}) {
  const url = getScriptUrl();
  if (!url) throw new Error("Missing Apps Script URL.");

  const response = await fetch(url, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error("Apps Script did not return JSON. Check deployment permissions.");
  }

  if (!data.ok) throw new Error(data.error || "Unknown Apps Script error.");
  return data;
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
  fillSelect(el("gasFilter"), "All gases", uniqueValues("Gas"));
  fillSelect(el("roomFilter"), "All rooms", uniqueValues("Room"));

  fillDatalist(el("gasOptions"), uniqueValues("Gas"));
  fillDatalist(el("roomOptions"), uniqueValues("Room"));
  fillDatalist(el("positionOptions"), uniqueValues("Position"));
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
  if (values.includes(current)) select.value = current;
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
  const query = el("searchInput").value.trim().toLowerCase();
  const gas = el("gasFilter").value;
  const status = el("statusFilter").value;
  const room = el("roomFilter").value;

  const filtered = tanks.filter(t => {
    const haystack = [
      t["Barcode"], t["Tank ID"], t["Gas"], t["Room"], t["Position"], t["Status"], t["Updated By"]
    ].join(" ").toLowerCase();

    return (!query || haystack.includes(query)) &&
           (!gas || t["Gas"] === gas) &&
           (!status || t["Status"] === status) &&
           (!room || t["Room"] === room);
  });

  el("resultsSummary").textContent = `${filtered.length} tank${filtered.length === 1 ? "" : "s"} found`;
  el("tankResults").innerHTML = filtered.map(tankCardHtml).join("") || emptyState("No tanks match that search.");

  document.querySelectorAll("[data-update-barcode]").forEach(btn => {
    btn.addEventListener("click", () => updateTankStatus(
      btn.dataset.updateBarcode,
      btn.dataset.status
    ));
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
      <div class="tank-detail">Updated: ${escapeHtml(t["Last Updated"] || "Never")} ${t["Updated By"] ? "by " + escapeHtml(t["Updated By"]) : ""}</div>

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
  const updatedBy = localStorage.getItem(STORAGE_KEYS.defaultUser) || prompt("Your initials?") || "";
  try {
    await api("updateStatus", { barcode, status, updatedBy });
    showToast(`Marked ${status}.`);
    await refreshData();
  } catch (err) {
    showToast(err.message);
  }
}

function showView(viewId) {
  document.querySelectorAll(".tab").forEach(btn => btn.classList.toggle("active", btn.dataset.view === viewId));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === viewId));
}

async function startScanner() {
  el("reader").classList.remove("hidden");
  el("startScanBtn").classList.add("hidden");
  el("stopScanBtn").classList.remove("hidden");

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

  el("reader").classList.add("hidden");
  el("startScanBtn").classList.remove("hidden");
  el("stopScanBtn").classList.add("hidden");
}

function handleBarcode(rawBarcode) {
  const barcode = String(rawBarcode || "").trim();
  if (!barcode) {
    showToast("No barcode entered.");
    return;
  }

  const found = tanks.find(t => String(t["Barcode"]).trim() === barcode);

  if (found) {
    el("scanResult").innerHTML = `
      <div class="summary">Tank found</div>
      ${tankCardHtml(found)}
    `;
    document.querySelectorAll("[data-update-barcode]").forEach(btn => {
      btn.addEventListener("click", () => updateTankStatus(btn.dataset.updateBarcode, btn.dataset.status));
    });
  } else {
    el("scanResult").innerHTML = `
      <div class="card warning">
        <h2>New barcode detected</h2>
        <p>This barcode is not in the inventory yet. Add it as a new tank?</p>
        <p><b>${escapeHtml(barcode)}</b></p>
        <button id="useScannedBarcodeBtn">Add this tank</button>
      </div>
    `;
    el("useScannedBarcodeBtn").addEventListener("click", () => {
      el("addBarcode").value = barcode;
      el("addStatus").value = "New";
      showView("addView");
      showToast("Barcode copied to Add screen.");
    });
  }
}

async function addTankFromForm() {
  const tank = {
    "Barcode": el("addBarcode").value.trim(),
    "Tank ID": el("addTankId").value.trim(),
    "Gas": el("addGas").value.trim(),
    "Room": el("addRoom").value.trim(),
    "Position": el("addPosition").value.trim(),
    "Status": el("addStatus").value,
    "Updated By": el("addUpdatedBy").value.trim() || localStorage.getItem(STORAGE_KEYS.defaultUser) || ""
  };

  if (!tank["Barcode"] || !tank["Gas"] || !tank["Room"] || !tank["Position"]) {
    showToast("Barcode, gas, room, and position are required.");
    return;
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
  ["addBarcode", "addTankId", "addGas", "addRoom", "addPosition"].forEach(id => el(id).value = "");
  el("addStatus").value = "New";
  el("addUpdatedBy").value = localStorage.getItem(STORAGE_KEYS.defaultUser) || "";
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
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function emptyState(message) {
  return `<div class="card"><p>${escapeHtml(message)}</p></div>`;
}

function showToast(message) {
  el("toast").textContent = message;
  el("toast").classList.remove("hidden");
  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => el("toast").classList.add("hidden"), 3200);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll("`", "&#096;");
}
