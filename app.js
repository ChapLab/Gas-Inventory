const STORAGE_KEYS = {
  scriptUrl: "gasTankScriptUrl",
  defaultUser: "gasTankDefaultUser"
};

let tanks = [];
let scanner = null;

const el = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadSettings();
  refreshData();
});

/* ---------------- EVENTS ---------------- */

function bindEvents() {
  el("refreshBtn").onclick = refreshData;
  el("saveScriptUrlBtn").onclick = () => saveScriptUrl(el("scriptUrlInput").value);
  el("manualLookupBtn").onclick = () => handleBarcode(el("manualBarcodeInput").value.trim());
}

/* ---------------- SETTINGS ---------------- */

function loadSettings() {
  el("scriptUrlInput").value = localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
}

function getScriptUrl() {
  return localStorage.getItem(STORAGE_KEYS.scriptUrl) || "";
}

function saveScriptUrl(url) {
  localStorage.setItem(STORAGE_KEYS.scriptUrl, url.trim());
  refreshData();
}

/* ---------------- JSONP FIX ---------------- */

function api(action, payload = {}) {
  return new Promise((resolve, reject) => {
    const url = getScriptUrl();
    if (!url) return reject(new Error("Missing Apps Script URL"));

    const callbackName = "cb_" + Date.now();

    window[callbackName] = function(data) {
      delete window[callbackName];
      script.remove();

      if (!data.ok) {
        reject(new Error(data.error || "API error"));
      } else {
        resolve(data);
      }
    };

    const params = new URLSearchParams({
      action,
      callback: callbackName,
      payload: JSON.stringify(payload)
    });

    const script = document.createElement("script");
    script.src = url + "?" + params.toString();
    script.onerror = () => reject(new Error("Connection failed"));

    document.body.appendChild(script);
  });
}

/* ---------------- DATA ---------------- */

async function refreshData() {
  if (!getScriptUrl()) return;

  try {
    const data = await api("list");
    tanks = data.tanks || [];
    renderResults();
  } catch (e) {
    alert("Connection error");
  }
}

/* ---------------- SEARCH ---------------- */

function renderResults() {
  const box = el("tankResults");
  if (!box) return;

  box.innerHTML = tanks.map(t => `
    <div style="padding:10px;border-bottom:1px solid #ccc">
      <b>${t["Tank ID"]}</b> (${t["Gas"]})<br>
      ${t["Room"]} – ${t["Position"]}<br>
      <b>${t["Status"]}</b>
    </div>
  `).join("");
}

/* ---------------- SCAN LOGIC ---------------- */

function handleBarcode(barcode) {
  if (!barcode) return alert("No barcode");

  const tank = tanks.find(t => t["Barcode"] === barcode);

  if (tank) {
    el("scanResult").innerHTML = `
      <h3>Update Tank</h3>
      <input id="uRoom" value="${tank["Room"]}">
      <input id="uPos" value="${tank["Position"]}">
      <select id="uStatus">
        <option ${tank["Status"]==="New"?"selected":""}>New</option>
        <option ${tank["Status"]==="In Use"?"selected":""}>In Use</option>
        <option ${tank["Status"]==="Empty"?"selected":""}>Empty</option>
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

/* ---------------- SAVE ---------------- */

async function saveUpdate(barcode) {
  await api("updateFull", {
    barcode,
    tank: {
      Room: el("uRoom").value,
      Position: el("uPos").value,
      Status: el("uStatus").value,
      "Updated By": ""
    }
  });

  refreshData();
}

async function saveNew(barcode) {
  await api("addTank", {
    tank: {
      Barcode: barcode,
      Gas: el("nGas").value,
      Room: el("nRoom").value,
      Position: el("nPos").value,
      Status: "New",
      "Updated By": ""
    }
  });

  refreshData();
}

/* ---------------- SCANNER ---------------- */

function startScanner() {
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
