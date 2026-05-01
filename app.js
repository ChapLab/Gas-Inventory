const ADD_NEW_VALUE="__ADD_NEW__";
const STORAGE_KEYS={scriptUrl:"gasTankScriptUrl",defaultUser:"gasTankDefaultUser"};

// Use var so these are safely initialized before any event handler can touch them.
// This also avoids temporal-dead-zone errors if a browser fires a handler during load.
var tanks=[];
var scanner=null;
var lastScanned="";
var scanCooldown=false;
var appBusy=false;
var scanBuffer=[];
var scanStartTime=0;
var scanPaused=false;
var scanBufferTimer=null;
var scanCollecting=false;

const el=id=>document.getElementById(id);
const normBarcode=value=>String(value||"").trim().replace(/[^a-zA-Z0-9]/g,"").toUpperCase();

function isBusy(){
  return window.appBusy===true;
}

function setBusy(value){
  window.appBusy=!!value;
}

window.appBusy=false;

document.addEventListener("DOMContentLoaded",()=>{
  bindEvents();
  loadSettings();
  refreshData();
});

function on(id,event,fn){
  const node=el(id);
  if(node) node.addEventListener(event,fn);
}

function bindEvents(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click",()=>showView(btn.dataset.view));
  });

  on("refreshBtn","click",()=>refreshData());
  on("saveScriptUrlBtn","click",()=>saveScriptUrl(el("scriptUrlInput").value));
  on("settingsSaveUrlBtn","click",()=>saveScriptUrl(el("settingsScriptUrlInput").value));
  on("saveDefaultUserBtn","click",saveDefaultUser);

  on("searchInput","input",renderResults);
  on("gasFilter","change",renderResults);
  on("statusFilter","change",renderResults);
  on("roomFilter","change",renderResults);

  on("addGasSelect","change",()=>toggleAddNewInput("addGasSelect","addGasNew"));
  on("addRoomSelect","change",()=>{
    toggleAddNewInput("addRoomSelect","addRoomNew");
    populatePositionSelectFor("addRoomSelect","addRoomNew","addPositionSelect","addPositionNew");
  });
  on("addRoomNew","input",()=>populatePositionSelectFor("addRoomSelect","addRoomNew","addPositionSelect","addPositionNew"));
  on("addPositionSelect","change",()=>toggleAddNewInput("addPositionSelect","addPositionNew"));

  document.querySelectorAll(".quick-filters button").forEach(btn=>{
    btn.addEventListener("click",()=>{
      if(el("statusFilter")) el("statusFilter").value=btn.dataset.status;
      renderResults();
    });
  });

  on("startScanBtn","click",startScanner);
  on("stopScanBtn","click",stopScanner);
  on("manualLookupBtn","click",()=>{
    const barcode=el("manualBarcodeInput").value.trim();
    handleBarcode(barcode);
  });
  on("addTankBtn","click",addTankFromForm);
  on("downloadCsvBtn","click",downloadCsv);
}

function loadSettings(){
  const url=localStorage.getItem(STORAGE_KEYS.scriptUrl)||"";
  const user=localStorage.getItem(STORAGE_KEYS.defaultUser)||"";

  if(el("scriptUrlInput")) el("scriptUrlInput").value=url;
  if(el("settingsScriptUrlInput")) el("settingsScriptUrlInput").value=url;
  if(el("defaultUserInput")) el("defaultUserInput").value=user;
  if(el("addUpdatedBy")) el("addUpdatedBy").value=user;

  updateConnectionStatus();
}

function getScriptUrl(){return localStorage.getItem(STORAGE_KEYS.scriptUrl)||"";}

function saveScriptUrl(url){
  url=(url||"").trim();
  if(!url){showToast("Paste the Apps Script Web App URL first.");return;}
  localStorage.setItem(STORAGE_KEYS.scriptUrl,url);
  if(el("scriptUrlInput")) el("scriptUrlInput").value=url;
  if(el("settingsScriptUrlInput")) el("settingsScriptUrlInput").value=url;
  updateConnectionStatus();
  refreshData();
  showToast("Connection saved.");
}

function saveDefaultUser(){
  const user=el("defaultUserInput").value.trim();
  localStorage.setItem(STORAGE_KEYS.defaultUser,user);
  if(el("addUpdatedBy")) el("addUpdatedBy").value=user;
  showToast("Initials saved.");
}

function getDefaultUser(){return localStorage.getItem(STORAGE_KEYS.defaultUser)||"";}

function updateConnectionStatus(message=""){
  const hasUrl=!!getScriptUrl();
  if(el("setupCard")) el("setupCard").classList.toggle("hidden",hasUrl);
  if(el("connectionStatus")) el("connectionStatus").textContent=message||(hasUrl?"Connected to Google Sheet":"Paste Apps Script URL to connect");
}

function api(action,payload={}){
  return new Promise((resolve,reject)=>{
    const url=getScriptUrl();
    if(!url){reject(new Error("Missing Apps Script URL."));return;}

    const callbackName="jsonp_"+Date.now()+"_"+Math.floor(Math.random()*100000);
    const params=new URLSearchParams({
      action,
      callback:callbackName,
      payload:JSON.stringify(payload)
    });

    const script=document.createElement("script");

    window[callbackName]=data=>{
      delete window[callbackName];
      if(script.parentNode) script.parentNode.removeChild(script);
      if(!data || !data.ok) reject(new Error((data&&data.error)||"Unknown Apps Script error."));
      else resolve(data);
    };

    script.onerror=()=>{
      delete window[callbackName];
      if(script.parentNode) script.parentNode.removeChild(script);
      reject(new Error("Connection failed. Check Apps Script deployment."));
    };

    script.src=`${url}?${params.toString()}`;
    document.body.appendChild(script);
  });
}

async function refreshData(){
  if(!getScriptUrl()){renderResults();return;}

  updateConnectionStatus("Refreshing...");

  try{
    const data=await api("list");
    tanks=data.tanks||[];
    updateConnectionStatus(`Loaded ${tanks.length} current tanks`);
    populateAllOptions();
    renderResults();
  }catch(err){
    updateConnectionStatus("Connection error");
    showToast(err.message);
  }
}

async function handleBarcode(rawBarcode){
  if(isBusy()){showToast("Still saving the previous tank. Try again in a second.");return;}

  const raw=String(rawBarcode||"").trim();
  const normalized=normBarcode(raw);

  if(!normalized){showToast("No barcode entered.");return;}

  if(!el("scanResult")){
    showToast("Scan result area not found.");
    return;
  }

  showToast("Checking barcode...");

  try{
    let found=tanks.find(t=>normBarcode(t["Barcode"])===normalized || normBarcode(t["Tank ID"])===normalized);

    if(getScriptUrl()){
      try{
        const data=await api("lookup",{barcode:raw,normalizedBarcode:normalized});
        if(data.tank){
          found=data.tank;
          const index=tanks.findIndex(t=>normBarcode(t["Barcode"])===normalized || normBarcode(t["Tank ID"])===normalized);
          if(index>=0) tanks[index]=found;
          else tanks.push(found);
          populateAllOptions();
          renderResults();
        }
      }catch(err){
        console.warn(err);
        showToast("Lookup failed. Using loaded tank list.");
      }
    }

    if(found){
      showToast("Existing tank found.");
      renderKnownTankUpdate(found,raw);
    }else{
      showToast("No match found. Opening new tank form.");
      renderNewTankSetup(raw);
    }
  }catch(err){
    console.error(err);
    renderErrorCard(raw,err);
  }

  setTimeout(()=>scrollToEl("scanResult"),100);
}

function renderErrorCard(raw,err){
  el("scanResult").innerHTML=`
    <div class="card error-card">
      <h2>Form error</h2>
      <p><b>Scanned:</b> ${escapeHtml(raw)}</p>
      <p>${escapeHtml(err.message||String(err))}</p>
      <button id="forceNewTankBtn">Open new tank form</button>
    </div>`;
  on("forceNewTankBtn","click",()=>renderNewTankSetup(raw));
  showToast("Form error. See message below.");
}

function populateAllOptions(){
  if(el("gasFilter")) fillSelect(el("gasFilter"),"All gases",uniqueValues("Gas"),false);
  if(el("roomFilter")) fillSelect(el("roomFilter"),"All rooms",uniqueValues("Room"),false);
  populateAddDropdowns();
}

function populateAddDropdowns(){
  fillSelect(el("addGasSelect"),"Select gas",uniqueValues("Gas"),true);
  fillSelect(el("addRoomSelect"),"Select room",uniqueValues("Room"),true);
  populatePositionSelectFor("addRoomSelect","addRoomNew","addPositionSelect","addPositionNew");
  toggleAddNewInput("addGasSelect","addGasNew",false);
  toggleAddNewInput("addRoomSelect","addRoomNew",false);
  toggleAddNewInput("addPositionSelect","addPositionNew",false);
}

function uniqueValues(key){
  return [...new Set(tanks.map(t=>(t[key]||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}

function positionsForRoom(room){
  const normalized=(room||"").trim().toLowerCase();
  const positions=tanks
    .filter(t=>!normalized || (t["Room"]||"").trim().toLowerCase()===normalized)
    .map(t=>(t["Position"]||"").trim())
    .filter(Boolean);
  return [...new Set(positions)].sort((a,b)=>a.localeCompare(b));
}

function selectedOrNew(selectId,newInputId){
  const select=el(selectId);
  const input=el(newInputId);
  if(!select) return "";
  return select.value===ADD_NEW_VALUE ? (input?input.value.trim():"") : select.value.trim();
}

function fillSelect(select,placeholder,values,includeAddNew){
  if(!select) return;
  const current=select.value;
  select.innerHTML="";

  const first=document.createElement("option");
  first.value="";
  first.textContent=placeholder;
  select.appendChild(first);

  values.forEach(v=>{
    const option=document.createElement("option");
    option.value=v;
    option.textContent=v;
    select.appendChild(option);
  });

  if(includeAddNew){
    const add=document.createElement("option");
    add.value=ADD_NEW_VALUE;
    add.textContent="Add new...";
    select.appendChild(add);
  }

  if([...select.options].some(o=>o.value===current)) select.value=current;
}

function toggleAddNewInput(selectId,inputId,focus=true){
  const select=el(selectId);
  const input=el(inputId);
  if(!select||!input) return;
  const isAdd=select.value===ADD_NEW_VALUE;
  input.classList.toggle("hidden",!isAdd);
  if(isAdd&&focus) setTimeout(()=>input.focus(),0);
}

function populatePositionSelectFor(roomSelectId,roomNewId,positionSelectId,positionNewId){
  const room=selectedOrNew(roomSelectId,roomNewId);
  const select=el(positionSelectId);
  const current=select?select.value:"";
  fillSelect(select,"Select position",positionsForRoom(room),true);
  if(select && [...select.options].some(o=>o.value===current)) select.value=current;
  toggleAddNewInput(positionSelectId,positionNewId,false);
}

function renderResults(){
  if(!el("tankResults")) return;

  const query=el("searchInput")?el("searchInput").value.trim().toLowerCase():"";
  const gas=el("gasFilter")?el("gasFilter").value:"";
  const status=el("statusFilter")?el("statusFilter").value:"";
  const room=el("roomFilter")?el("roomFilter").value:"";

  const filtered=tanks.filter(t=>{
    const haystack=[
      t["Barcode"],t["Tank ID"],t["Gas"],t["Room"],t["Position"],t["Status"],t["Updated By"]
    ].join(" ").toLowerCase();

    return (!query||haystack.includes(query)) &&
           (!gas||t["Gas"]===gas) &&
           (!status||t["Status"]===status) &&
           (!room||t["Room"]===room);
  });

  if(el("resultsSummary")) el("resultsSummary").textContent=`${filtered.length} tank${filtered.length===1?"":"s"} found`;
  el("tankResults").innerHTML=filtered.map(tankCardHtml).join("")||emptyState("No tanks match that search.");

  document.querySelectorAll("[data-update-barcode]").forEach(btn=>{
    btn.addEventListener("click",()=>updateTankStatus(btn.dataset.updateBarcode,btn.dataset.status));
  });
}

function tankCardHtml(t){
  const statusClass=statusToClass(t["Status"]);
  return `
    <article class="tank-card">
      <div class="tank-top">
        <div>
          <div class="tank-title">${escapeHtml(t["Tank ID"]||t["Barcode"]||"No tank ID")}</div>
          <div class="tank-detail"><b>${escapeHtml(t["Gas"]||"Unknown gas")}</b></div>
        </div>
        <span class="badge ${statusClass}">${escapeHtml(t["Status"]||"Unknown")}</span>
      </div>
      <div class="tank-detail">Room: <b>${escapeHtml(t["Room"]||"Not set")}</b></div>
      <div class="tank-detail">Position: <b>${escapeHtml(t["Position"]||"Not set")}</b></div>
      <div class="tank-detail">Barcode: ${escapeHtml(t["Barcode"]||"")}</div>
      <div class="date-grid">
        <div>Added: <b>${escapeHtml(formatDate(t["Date Added"])||"Not recorded")}</b></div>
        <div>Set in use: <b>${escapeHtml(formatDate(t["Date Set In Use"])||"Not recorded")}</b></div>
        <div>Emptied: <b>${escapeHtml(formatDate(t["Date Emptied"])||"Not recorded")}</b></div>
        <div>Last modified: <b>${escapeHtml(formatDate(t["Last Modified"])||"Not recorded")}</b>${t["Updated By"]?" by "+escapeHtml(t["Updated By"]):""}</div>
      </div>
      <div class="status-actions">
        <button data-update-barcode="${escapeAttr(t["Barcode"])}" data-status="New" ${t["Status"]==="New"?"disabled":""}>New</button>
        <button data-update-barcode="${escapeAttr(t["Barcode"])}" data-status="In Use" ${t["Status"]==="In Use"?"disabled":""}>In Use</button>
        <button data-update-barcode="${escapeAttr(t["Barcode"])}" data-status="Empty" ${t["Status"]==="Empty"?"disabled":""}>Empty</button>
      </div>
    </article>`;
}

function statusToClass(status){
  if(status==="In Use") return "InUse";
  if(status==="Empty") return "Empty";
  return "New";
}

function buildValueSelect(fieldName,selectId,newInputId,values,currentValue,placeholder){
  const hasCurrent=currentValue&&values.includes(currentValue);
  const options=[
    `<option value="">${placeholder}</option>`,
    ...values.map(v=>`<option value="${escapeAttr(v)}" ${v===currentValue?"selected":""}>${escapeHtml(v)}</option>`),
    `<option value="${ADD_NEW_VALUE}" ${currentValue&&!hasCurrent?"selected":""}>Add new...</option>`
  ].join("");

  const inputValue=currentValue&&!hasCurrent?currentValue:"";

  return `
    <label>${fieldName}</label>
    <select id="${selectId}">${options}</select>
    <input id="${newInputId}" class="${currentValue&&!hasCurrent?"":"hidden"} add-new-input" value="${escapeAttr(inputValue)}" placeholder="Type new ${fieldName.toLowerCase()}" />`;
}

function renderKnownTankUpdate(t,rawScanned=""){
  if(!el("scanResult")) return;
  el("scanResult").dataset.saved="false";

  const gases=uniqueValues("Gas");
  const rooms=uniqueValues("Room");
  const positions=positionsForRoom(t["Room"]);

  el("scanResult").innerHTML=`
    <div class="card success">
      <div class="scan-banner">Existing tank found</div>
      <p><b>Scanned:</b> ${escapeHtml(rawScanned||t["Barcode"]||"")}</p>
      <p><b>${escapeHtml(t["Tank ID"]||t["Barcode"]||"No tank ID")}</b> · ${escapeHtml(t["Gas"]||"Unknown gas")}</p>
      <p>Current: ${escapeHtml(t["Room"]||"No room")} · ${escapeHtml(t["Position"]||"No position")} · <b>${escapeHtml(t["Status"]||"No status")}</b></p>

      ${buildValueSelect("Gas","updateGasSelect","updateGasNew",gases,t["Gas"]||"","Select gas")}
      ${buildValueSelect("Room","updateRoomSelect","updateRoomNew",rooms,t["Room"]||"","Select room")}
      ${buildValueSelect("Position","updatePositionSelect","updatePositionNew",positions,t["Position"]||"","Select position")}

      <label>Status</label>
      <select id="updateStatus">
        <option ${t["Status"]==="New"?"selected":""}>New</option>
        <option ${t["Status"]==="In Use"?"selected":""}>In Use</option>
        <option ${t["Status"]==="Empty"?"selected":""}>Empty</option>
      </select>

      <label>Updated by</label>
      <input id="updateUpdatedBy" value="${escapeAttr(getDefaultUser()||t["Updated By"]||"")}" placeholder="Your initials" />

      <div class="date-grid">
        <div>Added: <b>${escapeHtml(formatDate(t["Date Added"])||"Not recorded")}</b></div>
        <div>Set in use: <b>${escapeHtml(formatDate(t["Date Set In Use"])||"Not recorded")}</b></div>
        <div>Emptied: <b>${escapeHtml(formatDate(t["Date Emptied"])||"Not recorded")}</b></div>
      </div>

      <div class="scan-actions">
        <button id="saveScannedUpdateBtn">Save update</button>
        <button id="clearScanFormBtn" class="secondary">Clear form</button>
      </div>
    </div>`;

  bindDynamicSelects("update");
  on("saveScannedUpdateBtn","click",()=>saveExistingTank(t["Barcode"]));
  on("clearScanFormBtn","click",()=>{el("scanResult").innerHTML="";resumeScanning();showToast("Scanner ready.");});
}

function renderNewTankSetup(rawScanned){
  if(!el("scanResult")) return;
  el("scanResult").dataset.saved="false";

  el("scanResult").innerHTML=`
    <div class="card warning">
      <div class="scan-banner">New barcode</div>
      <h2>New tank detected</h2>
      <p><b>Scanned:</b> ${escapeHtml(rawScanned)}</p>
      <p>This barcode is not in the shared inventory yet. The Tank ID will be the barcode.</p>

      <label>Barcode / Tank ID</label>
      <input id="newBarcode" value="${escapeAttr(rawScanned)}" readonly />

      ${buildValueSelect("Gas","newGasSelect","newGasNew",uniqueValues("Gas"),"","Select gas")}
      ${buildValueSelect("Room","newRoomSelect","newRoomNew",uniqueValues("Room"),"","Select room")}
      ${buildValueSelect("Position","newPositionSelect","newPositionNew",[],"","Select position")}

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
        <button id="clearScanFormBtn" class="secondary">Clear form</button>
      </div>
    </div>`;

  bindDynamicSelects("new");
  on("saveNewTankBtn","click",saveNewTankFromScan);
  on("clearScanFormBtn","click",()=>{el("scanResult").innerHTML="";resumeScanning();showToast("Scanner ready.");});
}

function bindDynamicSelects(prefix){
  on(`${prefix}GasSelect`,"change",()=>toggleAddNewInput(`${prefix}GasSelect`,`${prefix}GasNew`));
  on(`${prefix}RoomSelect`,"change",()=>{
    toggleAddNewInput(`${prefix}RoomSelect`,`${prefix}RoomNew`);
    populatePositionSelectFor(`${prefix}RoomSelect`,`${prefix}RoomNew`,`${prefix}PositionSelect`,`${prefix}PositionNew`);
  });
  on(`${prefix}RoomNew`,"input",()=>populatePositionSelectFor(`${prefix}RoomSelect`,`${prefix}RoomNew`,`${prefix}PositionSelect`,`${prefix}PositionNew`));
  on(`${prefix}PositionSelect`,"change",()=>toggleAddNewInput(`${prefix}PositionSelect`,`${prefix}PositionNew`));

  toggleAddNewInput(`${prefix}GasSelect`,`${prefix}GasNew`,false);
  toggleAddNewInput(`${prefix}RoomSelect`,`${prefix}RoomNew`,false);
  toggleAddNewInput(`${prefix}PositionSelect`,`${prefix}PositionNew`,false);
}

function localUpdateTank(barcode,updates,eventType="update"){
  const normalized=normBarcode(barcode);
  const now=new Date().toISOString();
  const index=tanks.findIndex(t=>normBarcode(t["Barcode"])===normalized||normBarcode(t["Tank ID"])===normalized);

  if(index>=0){
    tanks[index]={...tanks[index],...updates,"Barcode":barcode,"Tank ID":barcode,"Last Modified":now,"Event Type":eventType};
    if(updates["Status"]==="In Use") tanks[index]["Date Set In Use"]=now;
    if(updates["Status"]==="Empty") tanks[index]["Date Emptied"]=now;
  }else{
    tanks.push({...updates,"Barcode":barcode,"Tank ID":barcode,"Date Added":now,"Last Modified":now,"Event Type":eventType});
  }

  populateAllOptions();
  renderResults();
}

async function saveExistingTank(barcode){
  if(isBusy()){showToast("Already saving. Wait a second.");return;}

  const updatedBy=el("updateUpdatedBy").value.trim();
  if(updatedBy){
    localStorage.setItem(STORAGE_KEYS.defaultUser,updatedBy);
    if(el("defaultUserInput")) el("defaultUserInput").value=updatedBy;
    if(el("addUpdatedBy")) el("addUpdatedBy").value=updatedBy;
  }

  const updates={
    Gas:selectedOrNew("updateGasSelect","updateGasNew"),
    Room:selectedOrNew("updateRoomSelect","updateRoomNew"),
    Position:selectedOrNew("updatePositionSelect","updatePositionNew"),
    Status:el("updateStatus").value,
    "Updated By":updatedBy
  };

  if(!updates.Gas||!updates.Room||!updates.Position){
    showToast("Gas, room, and position are required.");
    return;
  }

  setBusy(true);
  localUpdateTank(barcode,updates,"update");
  showToast("Saving update...");

  try{
    await api("updateFull",{barcode,tank:updates});
    showToast("Tank updated.");
    el("scanResult").dataset.saved="true";
    el("scanResult").innerHTML=emptyState("Saved. Scanner ready for the next tank.");
    resumeScanning();
    scrollToEl("cameraCard");
  }catch(err){
    showToast(err.message);
    await refreshData();
  }finally{
    setBusy(false);
  }
}

async function saveNewTankFromScan(){
  if(isBusy()){showToast("Already saving. Wait a second.");return;}

  const barcode=el("newBarcode").value.trim();
  const tank={
    Barcode:barcode,
    "Tank ID":barcode,
    Gas:selectedOrNew("newGasSelect","newGasNew"),
    Room:selectedOrNew("newRoomSelect","newRoomNew"),
    Position:selectedOrNew("newPositionSelect","newPositionNew"),
    Status:el("newStatus").value,
    "Updated By":el("newUpdatedBy").value.trim()
  };

  await saveNewTank(tank,true);
}

async function addTankFromForm(){
  const barcode=el("addBarcode").value.trim();
  const tank={
    Barcode:barcode,
    "Tank ID":barcode,
    Gas:selectedOrNew("addGasSelect","addGasNew"),
    Room:selectedOrNew("addRoomSelect","addRoomNew"),
    Position:selectedOrNew("addPositionSelect","addPositionNew"),
    Status:el("addStatus").value,
    "Updated By":el("addUpdatedBy").value.trim()||getDefaultUser()
  };

  await saveNewTank(tank,false);
}

async function saveNewTank(tank,fromScan){
  if(isBusy()){showToast("Already saving. Wait a second.");return;}

  if(!tank.Barcode||!tank.Gas||!tank.Room||!tank.Position){
    showToast("Barcode, gas, room, and position are required.");
    return;
  }

  if(tank["Updated By"]){
    localStorage.setItem(STORAGE_KEYS.defaultUser,tank["Updated By"]);
    if(el("defaultUserInput")) el("defaultUserInput").value=tank["Updated By"];
    if(el("addUpdatedBy")) el("addUpdatedBy").value=tank["Updated By"];
  }

  setBusy(true);
  const now=new Date().toISOString();
  localUpdateTank(tank.Barcode,{...tank,"Date Added":now},"add");
  showToast("Saving new tank...");

  try{
    await api("addTank",{tank});
    showToast("New tank added.");
    if(fromScan && el("scanResult")){
      el("scanResult").dataset.saved="true";
      el("scanResult").innerHTML=emptyState("Saved. Scanner ready for the next tank.");
      resumeScanning();
    }else{
      clearAddForm();
      showView("scanView");
    }
    scrollToEl("cameraCard");
  }catch(err){
    showToast(err.message);
    await refreshData();
  }finally{
    setBusy(false);
  }
}

async function updateTankStatus(barcode,status){
  if(isBusy()){showToast("Already saving. Wait a second.");return;}
  const updatedBy=getDefaultUser()||prompt("Your initials?")||"";

  setBusy(true);
  localUpdateTank(barcode,{Status:status,"Updated By":updatedBy},"status");
  showToast(`Saving ${status}...`);

  try{
    await api("updateStatus",{barcode,status,updatedBy});
    showToast(`Marked ${status}.`);
  }catch(err){
    showToast(err.message);
    await refreshData();
  }finally{
    setBusy(false);
  }
}

function clearAddForm(){
  ["addBarcode","addGasNew","addRoomNew","addPositionNew"].forEach(id=>{if(el(id)) el(id).value="";});
  if(el("addGasSelect")) el("addGasSelect").value="";
  if(el("addRoomSelect")) el("addRoomSelect").value="";
  if(el("addPositionSelect")) el("addPositionSelect").value="";
  if(el("addStatus")) el("addStatus").value="New";
  if(el("addUpdatedBy")) el("addUpdatedBy").value=getDefaultUser();
  populateAddDropdowns();
}



function pauseScanning(){
  scanPaused=true;
}

function resumeScanning(){
  scanPaused=false;
  scanCollecting=false;
  scanBuffer=[];
  scanStartTime=0;
  lastScanned="";
  scanCooldown=false;
}

function queueScanResult(decodedText){
  if(scanPaused){
    return;
  }

  if(isBusy()){
    showToast("Still saving previous tank.");
    return;
  }

  const raw=String(decodedText||"").trim();
  if(!raw) return;

  if(!scanCollecting){
    scanCollecting=true;
    scanBuffer=[];
    scanStartTime=Date.now();

    setTimeout(()=>finalizeScanBuffer(),200);
  }

  if(scanBuffer.length < 2){
    scanBuffer.push(raw);
  }

  if(scanBuffer.length >= 2){
    finalizeScanBuffer();
  }
}

  const raw = String(decodedText || "").trim();
  if (!raw) {
    console.warn("Empty barcode read, ignoring.");
    return;
  }

  // Start a 0.5 second collection window. During this time, collect up to 5 reads.
  if(!scanCollecting){
    scanCollecting=true;
    scanBuffer=[];
    showToast("Reading barcode... hold steady.");

    scanBufferTimer=setTimeout(()=>{
      finalizeScanBuffer();
    },500);
  }

  // Only add every ~0.1 s worth of reads, and cap at 5 reads total.
  if(scanBuffer.length<5){
    scanBuffer.push(raw);
  }

  if(scanBuffer.length>=5){
    finalizeScanBuffer();
  }
}

function finalizeScanBuffer(){
  if(!scanCollecting) return;
  scanCollecting=false;

  const reads=scanBuffer.slice(0,2);
  scanBuffer=[];

  if(reads.length===0){
    showToast("No barcode captured.");
    return;
  }

  let chosen;

  if(reads.length===2 && reads[0] === reads[1]){
    chosen = reads[0]; // instant accept if identical
  } else {
    chosen = reads.sort((a,b)=>b.length-a.length)[0]; // fallback longest
  }

  pauseScanning();
  showToast("Barcode confirmed");
  handleBarcode(chosen);
}

  const reads=scanBuffer.slice(0,5);
  scanBuffer=[];

  if(reads.length===0){
    showToast("No barcode captured.");
    return;
  }

  const chosen=chooseBestBarcode(reads);
  showToast(`Barcode confirmed: ${chosen}`);
  handleBarcode(chosen);
}

function chooseBestBarcode(reads){
  // Group normalized reads. Prefer the most frequent normalized value.
  // If tied, prefer the longer raw read because partial barcode reads are often shorter.
  const groups={};

  reads.forEach(raw=>{
    const norm=normBarcode(raw);
    if(!norm)return;
    if(!groups[norm]){
      groups[norm]={norm,raws:[],count:0,maxLen:0,bestRaw:raw};
    }
    groups[norm].raws.push(raw);
    groups[norm].count++;
    if(String(raw).length>groups[norm].maxLen){
      groups[norm].maxLen=String(raw).length;
      groups[norm].bestRaw=raw;
    }
  });

  const candidates=Object.values(groups);

  if(candidates.length===0){
    return reads.sort((a,b)=>String(b).length-String(a).length)[0];
  }

  candidates.sort((a,b)=>{
    if(b.count!==a.count)return b.count-a.count;
    if(b.maxLen!==a.maxLen)return b.maxLen-a.maxLen;
    return b.norm.length-a.norm.length;
  });

  return candidates[0].bestRaw;
}

function startScanner(){
  resumeScanning();
  if(!window.Html5QrcodeScanner){showToast("Scanner library did not load. Check internet connection.");return;}
  if(scanner){showToast("Scanner is already open.");return;}
  if(!el("reader")){showToast("Scanner area not found.");return;}

  el("reader").classList.remove("hidden");
  if(el("startScanBtn")) el("startScanBtn").classList.add("hidden");
  if(el("stopScanBtn")) el("stopScanBtn").classList.remove("hidden");

  scanner=new Html5QrcodeScanner("reader",{
    fps:10,
    qrbox:(viewfinderWidth, viewfinderHeight)=>{ return {width:Math.floor(viewfinderWidth*0.5), height:Math.floor(viewfinderHeight*0.2)}; },
    rememberLastUsedCamera:true,
    supportedScanTypes:[Html5QrcodeScanType.SCAN_TYPE_CAMERA],
    formatsToSupport:[
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.QR_CODE
    ],
    videoConstraints:{
      facingMode:{ideal:"environment"},
      width:{ideal:1920},
      height:{ideal:1080}
    }
  },false);

  scanner.render(decodedText=>{
    if(scanCooldown && decodedText===lastScanned) return;

    lastScanned=decodedText;
    queueScanResult(decodedText);

    // Short cooldown so the same camera frame does not spam the buffer,
    // while still allowing about 5 reads over 0.5 seconds.
    scanCooldown=true;
    setTimeout(()=>{scanCooldown=false;},100);
  });
}

async function stopScanner(){
  scanCollecting=false;
  scanBuffer=[];
  if(scanBufferTimer){clearTimeout(scanBufferTimer);scanBufferTimer=null;}
  if(scanner){
    try{await scanner.clear();}catch(err){console.warn(err);}
    scanner=null;
  }
  if(el("reader")) el("reader").classList.add("hidden");
  if(el("startScanBtn")) el("startScanBtn").classList.remove("hidden");
  if(el("stopScanBtn")) el("stopScanBtn").classList.add("hidden");
}

function showView(viewId){
  document.querySelectorAll(".tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.view===viewId));
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===viewId));
}

function scrollToEl(id){
  const node=el(id);
  if(node) node.scrollIntoView({behavior:"smooth",block:"start"});
}

function downloadCsv(){
  const headers=["Barcode","Tank ID","Gas","Room","Position","Status","Date Added","Date Set In Use","Date Emptied","Last Modified","Updated By","Event ID","Event Type"];
  const rows=tanks.map(t=>headers.map(h=>csvEscape(t[h]||"")).join(","));
  const csv=[headers.join(","),...rows].join("\n");
  const blob=new Blob([csv],{type:"text/csv"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`gas-tank-inventory-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvEscape(value){
  value=String(value);
  return /[",\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;
}

function emptyState(message){
  return `<div class="card"><p>${escapeHtml(message)}</p></div>`;
}

function showToast(message){
  if(!el("toast")){alert(message);return;}
  el("toast").textContent=message;
  el("toast").classList.remove("hidden");
  clearTimeout(window.toastTimeout);
  window.toastTimeout=setTimeout(()=>el("toast").classList.add("hidden"),3200);
}

function formatDate(value){
  if(!value) return "";
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function escapeHtml(str){
  return String(str??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function escapeAttr(str){
  return escapeHtml(str).replaceAll("`","&#096;");
}


// Explicitly expose key handlers for browser callbacks/debugging.
window.handleBarcode = handleBarcode;
window.addTankFromForm = addTankFromForm;
window.saveDefaultUser = saveDefaultUser;
window.refreshData = refreshData;
