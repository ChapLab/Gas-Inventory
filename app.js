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
var scanBufferTimer=null;
var scanCollecting=false;
var scanPaused=false;
var photoImage=null;
var photoTransform={x:0,y:0,scale:1,rotation:0};
var photoPointers=new Map();
var photoLastGesture=null;

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
  on("photoBarcodeInput","change",handlePhotoBarcodeInput);
  on("photoRotateLeftBtn","click",()=>rotatePhoto(-90));
  on("photoRotateRightBtn","click",()=>rotatePhoto(90));
  on("photoResetBtn","click",resetPhotoView);
  on("photoScanBtn","click",scanPhotoRoi);
  setupPhotoTouchEvents();
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

  on("clearScanFormBtn","click",()=>{
    el("scanResult").innerHTML="";
    scanPaused = false;
    showToast("Ready to scan next tank.");
  });
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

  on("clearScanFormBtn","click",()=>{
    el("scanResult").innerHTML="";
    scanPaused = false;
    showToast("Ready to scan next tank.");
  });
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
    el("scanResult").innerHTML=emptyState("Saved. Keep scanning or stop the scanner when done.");
    scrollToEl("cameraCard");
    scanPaused = false;
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
      el("scanResult").innerHTML=emptyState("Saved. Keep scanning or stop the scanner when done.");
    }else{
      clearAddForm();
      showView("scanView");
    }
    scrollToEl("cameraCard");
    scanPaused = false;
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


function queueScanResult(decodedText){
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

    scanBufferTimer=setTimeout(()=>finalizeScanBuffer(),200);
  }

  if(scanBuffer.length < 2){
    scanBuffer.push(raw);
  }

  if(scanBuffer.length >= 2){
    finalizeScanBuffer();
  }
}

function finalizeScanBuffer(){
  if(!scanCollecting) return;
  scanCollecting=false;

  if(scanBufferTimer){
    clearTimeout(scanBufferTimer);
    scanBufferTimer=null;
  }

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

  scanPaused = true;
  showToast("Barcode confirmed");
  handleBarcode(chosen);
}

function startScanner(){
  if(!window.Html5QrcodeScanner){showToast("Scanner library did not load. Check internet connection.");return;}
  if(scanner){showToast("Scanner is already open.");return;}
  if(!el("reader")){showToast("Scanner area not found.");return;}

  el("reader").classList.remove("hidden");
  if(el("startScanBtn")) el("startScanBtn").classList.add("hidden");
  if(el("stopScanBtn")) el("stopScanBtn").classList.remove("hidden");

  scanner=new Html5QrcodeScanner("reader",{
    fps:10,
    qrbox:(viewfinderWidth, viewfinderHeight)=>{ return {width:Math.floor(viewfinderWidth*0.25), height:Math.floor(viewfinderHeight*0.10)}; },
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
    if(scanPaused) return;
    if(scanCooldown && decodedText===lastScanned) return;

    lastScanned=decodedText;
    queueScanResult(decodedText);

    scanCooldown=true;
    setTimeout(()=>{scanCooldown=false;},100);
  });
}

async function stopScanner(){
  scanCollecting=false;
  scanBuffer=[];
  scanPaused=false;
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



function setupPhotoTouchEvents(){
  const canvas=el("photoCanvas");
  if(!canvas)return;
  canvas.addEventListener("pointerdown",e=>{
    if(!photoImage)return;
    canvas.setPointerCapture(e.pointerId);
    photoPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    photoLastGesture=getPhotoGesture();
  });
  canvas.addEventListener("pointermove",e=>{
    if(!photoImage||!photoPointers.has(e.pointerId))return;
    photoPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const gesture=getPhotoGesture();
    if(!gesture||!photoLastGesture){photoLastGesture=gesture;return;}
    if(photoPointers.size===1){
      photoTransform.x += gesture.cx-photoLastGesture.cx;
      photoTransform.y += gesture.cy-photoLastGesture.cy;
    }else{
      const scaleFactor=gesture.distance/photoLastGesture.distance;
      const rotationDelta=gesture.angle-photoLastGesture.angle;
      photoTransform.scale=Math.max(0.2,Math.min(8,photoTransform.scale*scaleFactor));
      photoTransform.rotation += rotationDelta;
      photoTransform.x += gesture.cx-photoLastGesture.cx;
      photoTransform.y += gesture.cy-photoLastGesture.cy;
    }
    photoLastGesture=gesture;
    drawPhotoEditor();
  });
  ["pointerup","pointercancel","pointerleave"].forEach(evt=>canvas.addEventListener(evt,e=>{
    photoPointers.delete(e.pointerId);
    photoLastGesture=getPhotoGesture();
  }));
}
function getPhotoGesture(){
  const pts=[...photoPointers.values()];
  if(pts.length===0)return null;
  if(pts.length===1)return {cx:pts[0].x,cy:pts[0].y,distance:1,angle:0};
  const a=pts[0],b=pts[1];
  return {cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,distance:Math.hypot(b.x-a.x,b.y-a.y)||1,angle:Math.atan2(b.y-a.y,b.x-a.x)};
}
function handlePhotoBarcodeInput(e){
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  const img=new Image();
  img.onload=()=>{
    photoImage=img;
    resetPhotoView(false);
    if(el("photoEditor"))el("photoEditor").classList.remove("hidden");
    drawPhotoEditor();
    showToast("Photo loaded. Move barcode into the box.");
  };
  img.onerror=()=>showToast("Could not load image.");
  img.src=URL.createObjectURL(file);
}
function resetPhotoView(redraw=true){
  const canvas=el("photoCanvas");
  if(!canvas||!photoImage)return;
  const rect=canvas.getBoundingClientRect();
  const baseScale=Math.min(rect.width/photoImage.width,rect.height/photoImage.height);
  photoTransform={x:0,y:0,scale:baseScale,rotation:0};
  if(redraw)drawPhotoEditor();
}
function rotatePhoto(degrees){
  if(!photoImage)return;
  photoTransform.rotation += degrees*Math.PI/180;
  drawPhotoEditor();
}
function resizePhotoCanvasToDisplay(canvas){
  const rect=canvas.getBoundingClientRect();
  const dpr=window.devicePixelRatio||1;
  const w=Math.max(1,Math.floor(rect.width*dpr));
  const h=Math.max(1,Math.floor(rect.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  return {w,h,dpr};
}
function drawPhotoEditor(){
  const canvas=el("photoCanvas");
  if(!canvas||!photoImage)return;
  const {w,h,dpr}=resizePhotoCanvasToDisplay(canvas);
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,w,h);
  ctx.save();
  ctx.translate(w/2+photoTransform.x*dpr,h/2+photoTransform.y*dpr);
  ctx.rotate(photoTransform.rotation);
  ctx.scale(photoTransform.scale*dpr,photoTransform.scale*dpr);
  ctx.drawImage(photoImage,-photoImage.width/2,-photoImage.height/2);
  ctx.restore();
}
async function scanPhotoRoi(){
  if(!photoImage){showToast("Load a photo first.");return;}
  if(isBusy()){showToast("Still saving previous tank.");return;}
  try{
    drawPhotoEditor();
    const source=el("photoCanvas");
    const crop=document.createElement("canvas");
    const roiW=Math.floor(source.width*0.42);
    const roiH=Math.floor(source.height*0.14);
    const sx=Math.floor((source.width-roiW)/2);
    const sy=Math.floor((source.height-roiH)/2);
    const bufferW=Math.floor(roiW*0.35);
    const bufferH=Math.floor(roiH*0.75);
    const bsx=Math.max(0,sx-bufferW);
    const bsy=Math.max(0,sy-bufferH);
    const bsw=Math.min(source.width-bsx,roiW+2*bufferW);
    const bsh=Math.min(source.height-bsy,roiH+2*bufferH);
    crop.width=bsw; crop.height=bsh;
    crop.getContext("2d").drawImage(source,bsx,bsy,bsw,bsh,0,0,bsw,bsh);
    const blob=await new Promise(resolve=>crop.toBlob(resolve,"image/png"));
    if(!blob){showToast("Could not process photo.");return;}
    const file=new File([blob],"barcode-roi.png",{type:"image/png"});
    const qr=new Html5Qrcode("photoReader");
    showToast("Scanning photo...");
    const decoded=await qr.scanFile(file,false);
    showToast("Barcode found in photo.");
    await handleBarcode(decoded);
  }catch(err){
    console.error(err);
    showToast("No barcode found in photo. Try zooming or rotating.");
  }
}

// Explicitly expose key handlers for browser callbacks/debugging.
window.handleBarcode = handleBarcode;
window.addTankFromForm = addTankFromForm;
window.saveDefaultUser = saveDefaultUser;
window.refreshData = refreshData;


/* ---------------- PHOTO SCAN ROBUST OVERRIDE v17 ----------------
   This overrides the v16 photo scan path. It scans the visible guide box PLUS
   a generous buffer and also tries a full transformed canvas fallback.
*/

function getPhotoCanvasElement(){
  return document.getElementById("photoCanvas") ||
         document.getElementById("photoScanCanvas") ||
         document.querySelector("canvas.photo-canvas") ||
         document.querySelector("#photoScanArea canvas") ||
         document.querySelector("canvas");
}

function getPhotoImageElement(){
  return document.getElementById("photoPreviewImage") ||
         document.getElementById("photoImage") ||
         document.querySelector("#photoScanArea img") ||
         document.querySelector("img.photo-preview");
}

async function scanPhotoRobust(){
  try{
    showToast("Scanning photo...");

    const sourceCanvas = getPhotoCanvasElement();

    if(!sourceCanvas){
      showToast("Photo canvas not found.");
      return;
    }

    // Try several versions because barcode detection is sensitive to crop size and contrast.
    const canvases = buildPhotoScanCanvases(sourceCanvas);

    let lastError = null;

    for(let i=0;i<canvases.length;i++){
      try{
        const decoded = await decodeCanvasWithHtml5Qrcode(canvases[i]);
        if(decoded){
          showToast("Barcode found in photo.");
          handleBarcode(decoded);
          return;
        }
      }catch(err){
        lastError = err;
        console.warn("Photo scan attempt failed", i, err);
      }
    }

    showToast("No barcode found. Zoom out or include the full barcode.");
    if(lastError) console.warn(lastError);

  }catch(err){
    console.error(err);
    showToast("Photo scan failed: " + (err.message || err));
  }
}

function buildPhotoScanCanvases(sourceCanvas){
  const list = [];

  // 1) Full visible canvas exactly as user sees it.
  list.push(cloneCanvas(sourceCanvas));

  // 2) Center crop with buffer around the guide area.
  // Since the ROI is visually small, use a much bigger buffered crop:
  // 90% width and 50% height centered. This prevents over-cropping.
  list.push(cropCanvas(sourceCanvas, 0.05, 0.25, 0.90, 0.50));

  // 3) Even wider strip for long Code128-style tank barcodes.
  list.push(cropCanvas(sourceCanvas, 0.00, 0.30, 1.00, 0.40));

  // 4) Contrast-enhanced versions of above.
  const originals = list.slice();
  originals.forEach(c => list.push(makeHighContrastCanvas(c)));

  // 5) Rotated small-angle attempts in case the barcode is slightly tilted.
  originals.forEach(c => {
    list.push(rotateCanvas(c, 2));
    list.push(rotateCanvas(c, -2));
    list.push(rotateCanvas(c, 5));
    list.push(rotateCanvas(c, -5));
  });

  return list.filter(Boolean);
}

function cloneCanvas(canvas){
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  c.getContext("2d").drawImage(canvas,0,0);
  return c;
}

function cropCanvas(canvas, xFrac, yFrac, wFrac, hFrac){
  const sx = Math.max(0, Math.floor(canvas.width * xFrac));
  const sy = Math.max(0, Math.floor(canvas.height * yFrac));
  const sw = Math.min(canvas.width - sx, Math.floor(canvas.width * wFrac));
  const sh = Math.min(canvas.height - sy, Math.floor(canvas.height * hFrac));

  const c = document.createElement("canvas");
  // Upscale crop for older phones / lower-res images
  c.width = Math.max(800, sw * 2);
  c.height = Math.max(300, sh * 2);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function makeHighContrastCanvas(canvas){
  const c = cloneCanvas(canvas);
  const ctx = c.getContext("2d");
  const img = ctx.getImageData(0,0,c.width,c.height);
  const d = img.data;

  for(let i=0;i<d.length;i+=4){
    const gray = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    const v = gray > 128 ? 255 : 0;
    d[i]=v; d[i+1]=v; d[i+2]=v;
  }

  ctx.putImageData(img,0,0);
  return c;
}

function rotateCanvas(canvas, degrees){
  const rad = degrees * Math.PI / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = canvas.width;
  const h = canvas.height;
  const newW = Math.ceil(w*cos + h*sin);
  const newH = Math.ceil(w*sin + h*cos);

  const c = document.createElement("canvas");
  c.width = newW;
  c.height = newH;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0,0,newW,newH);
  ctx.translate(newW/2,newH/2);
  ctx.rotate(rad);
  ctx.drawImage(canvas,-w/2,-h/2);
  return c;
}

function decodeCanvasWithHtml5Qrcode(canvas){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>{
      if(!blob){
        reject(new Error("Could not create image blob."));
        return;
      }

      const file = new File([blob], "photo-scan.png", {type:"image/png"});

      
      let tempId = "photoDecodeReader";
      let temp = document.getElementById(tempId);
      if(!temp){
        temp = document.createElement("div");
        temp.id = tempId;
        temp.style.display = "none";
        document.body.appendChild(temp);
      }
      const qr = new Html5Qrcode(tempId);
      qr.scanFile(file, true)
        .then(decoded => {
          try{ qr.clear(); }catch(e){}
          resolve(decoded);
        })
        .catch(err => {
          try{ qr.clear(); }catch(e){}
          reject(err);
        });
    }, "image/png");
  });
}

// If v16 has a button named scanPhotoBtn, force it to use the robust scanner.
// Also expose the function globally for inline handlers.
window.scanPhotoRobust = scanPhotoRobust;
window.scanPhoto = scanPhotoRobust;
window.scanPhotoImage = scanPhotoRobust;

document.addEventListener("DOMContentLoaded",()=>{
  const ids=["scanPhotoBtn","photoScanBtn","scanImageBtn"];
  ids.forEach(id=>{
    const btn=document.getElementById(id);
    if(btn){
      btn.addEventListener("click",(e)=>{
        e.preventDefault();
        scanPhotoRobust();
      });
    }
  });
});


/* ---------------- PHOTO MODE v18 CLEAN OVERRIDE ---------------- */

var photoState = {
  img: null,
  scale: 1,
  minScale: 1,
  maxScale: 8,
  x: 0,
  y: 0,
  rotation: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  pointers: new Map(),
  lastPinchDist: 0,
  lastPinchAngle: 0
};

function initPhotoModeV18(){
  const input = el("photoInput");
  const canvas = el("photoCanvas");
  const reset = el("photoResetBtn");
  const left = el("photoRotateLeftBtn");
  const right = el("photoRotateRightBtn");
  const scan = el("scanPhotoBtn");

  if(input) input.addEventListener("change", loadPhotoFileV18);
  if(reset) reset.addEventListener("click", resetPhotoViewV18);
  if(left) left.addEventListener("click", ()=>{photoState.rotation-=90; drawPhotoV18();});
  if(right) right.addEventListener("click", ()=>{photoState.rotation+=90; drawPhotoV18();});
  if(scan) scan.addEventListener("click", (e)=>{e.preventDefault(); scanPhotoV18();});

  if(canvas){
    canvas.addEventListener("pointerdown", photoPointerDownV18);
    canvas.addEventListener("pointermove", photoPointerMoveV18);
    canvas.addEventListener("pointerup", photoPointerUpV18);
    canvas.addEventListener("pointercancel", photoPointerUpV18);
    canvas.addEventListener("wheel", photoWheelV18, {passive:false});
  }

  window.addEventListener("resize", ()=>drawPhotoV18());
}

function loadPhotoFileV18(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;

  const img = new Image();
  img.onload = ()=>{
    photoState.img = img;
    fitPhotoToCanvasV18();
    drawPhotoV18();
    showToast("Photo loaded. Move it into the guide box.");
  };
  img.onerror = ()=>showToast("Could not load photo.");
  img.src = URL.createObjectURL(file);
}

function getPhotoCanvasV18(){
  return el("photoCanvas");
}

function canvasSizeV18(canvas){
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if(canvas.width !== width || canvas.height !== height){
    canvas.width = width;
    canvas.height = height;
  }
  return {width,height,dpr};
}

function fitPhotoToCanvasV18(){
  const canvas = getPhotoCanvasV18();
  if(!canvas || !photoState.img) return;

  const {width, height} = canvasSizeV18(canvas);
  const img = photoState.img;

  // Fit whole image inside canvas initially. This fixes the "must click reset" issue.
  const fitScale = Math.min(width / img.width, height / img.height);
  photoState.minScale = fitScale * 0.45;   // allow zooming out past fit if image is large
  photoState.scale = fitScale;
  photoState.maxScale = fitScale * 12;
  photoState.x = width / 2;
  photoState.y = height / 2;
  photoState.rotation = 0;
}

function resetPhotoViewV18(){
  fitPhotoToCanvasV18();
  drawPhotoV18();
}

function drawPhotoV18(){
  const canvas = getPhotoCanvasV18();
  if(!canvas) return;

  const {width, height} = canvasSizeV18(canvas);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,width,height);
  ctx.fillStyle = "#111";
  ctx.fillRect(0,0,width,height);

  if(!photoState.img){
    ctx.fillStyle = "#ddd";
    ctx.font = `${Math.max(16, width/30)}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText("Load or take a photo", width/2, height/2);
    return;
  }

  ctx.save();
  ctx.translate(photoState.x, photoState.y);
  ctx.rotate(photoState.rotation * Math.PI / 180);
  ctx.scale(photoState.scale, photoState.scale);
  ctx.drawImage(photoState.img, -photoState.img.width/2, -photoState.img.height/2);
  ctx.restore();
}

function photoPointerDownV18(e){
  const canvas = getPhotoCanvasV18();
  if(!canvas || !photoState.img) return;
  canvas.setPointerCapture(e.pointerId);
  photoState.pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

  if(photoState.pointers.size === 1){
    photoState.dragging = true;
    photoState.lastX = e.clientX;
    photoState.lastY = e.clientY;
  }

  if(photoState.pointers.size === 2){
    const pts = [...photoState.pointers.values()];
    photoState.lastPinchDist = distV18(pts[0], pts[1]);
    photoState.lastPinchAngle = angleV18(pts[0], pts[1]);
  }
}

function photoPointerMoveV18(e){
  if(!photoState.img || !photoState.pointers.has(e.pointerId)) return;
  photoState.pointers.set(e.pointerId, {x:e.clientX, y:e.clientY});

  const canvas = getPhotoCanvasV18();
  const dpr = window.devicePixelRatio || 1;

  if(photoState.pointers.size === 1 && photoState.dragging){
    const dx = (e.clientX - photoState.lastX) * dpr;
    const dy = (e.clientY - photoState.lastY) * dpr;
    photoState.x += dx;
    photoState.y += dy;
    photoState.lastX = e.clientX;
    photoState.lastY = e.clientY;
    drawPhotoV18();
  }

  if(photoState.pointers.size === 2){
    const pts = [...photoState.pointers.values()];
    const newDist = distV18(pts[0], pts[1]);
    const newAngle = angleV18(pts[0], pts[1]);

    if(photoState.lastPinchDist){
      const factor = newDist / photoState.lastPinchDist;
      zoomPhotoV18(factor);
    }

    if(photoState.lastPinchAngle !== null){
      let delta = newAngle - photoState.lastPinchAngle;
      if(delta > 180) delta -= 360;
      if(delta < -180) delta += 360;
      photoState.rotation += delta;
    }

    photoState.lastPinchDist = newDist;
    photoState.lastPinchAngle = newAngle;
    drawPhotoV18();
  }
}

function photoPointerUpV18(e){
  const canvas = getPhotoCanvasV18();
  if(canvas) {
    try{canvas.releasePointerCapture(e.pointerId);}catch(err){}
  }
  photoState.pointers.delete(e.pointerId);
  photoState.dragging = false;

  if(photoState.pointers.size < 2){
    photoState.lastPinchDist = 0;
    photoState.lastPinchAngle = 0;
  }

  if(photoState.pointers.size === 1){
    const pt = [...photoState.pointers.values()][0];
    photoState.dragging = true;
    photoState.lastX = pt.x;
    photoState.lastY = pt.y;
  }
}

function photoWheelV18(e){
  if(!photoState.img) return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.08 : 0.92;
  zoomPhotoV18(factor);
  drawPhotoV18();
}

function zoomPhotoV18(factor){
  const oldScale = photoState.scale;
  const next = Math.max(photoState.minScale, Math.min(photoState.maxScale, oldScale * factor));
  photoState.scale = next;
}

function distV18(a,b){
  return Math.hypot(a.x-b.x, a.y-b.y);
}

function angleV18(a,b){
  return Math.atan2(b.y-a.y, b.x-a.x) * 180 / Math.PI;
}

async function scanPhotoV18(){
  const canvas = getPhotoCanvasV18();
  if(!canvas || !photoState.img){
    showToast("Load or take a photo first.");
    return;
  }

  drawPhotoV18();
  showToast("Scanning photo...");

  const attempts = buildPhotoAttemptsV18(canvas);

  for(let i=0; i<attempts.length; i++){
    try{
      const decoded = await decodeCanvasV18(attempts[i]);
      if(decoded){
        showToast("Barcode found.");
        handleBarcode(decoded);
        return;
      }
    }catch(err){
      console.warn("photo attempt failed", i, err);
    }
  }

  showToast("No barcode found. Try zooming out so the full barcode is visible.");
}

function buildPhotoAttemptsV18(canvas){
  const attempts = [];

  // The displayed canvas is already the adjusted photo. Scan it first.
  attempts.push(cloneCanvasV18(canvas));

  // The guide is 75% wide x 15% high, but use a buffered crop around it.
  // This is intentionally much larger than the visible guide.
  attempts.push(cropCanvasV18(canvas, 0.02, 0.28, 0.96, 0.44));
  attempts.push(cropCanvasV18(canvas, 0.00, 0.20, 1.00, 0.60));
  attempts.push(cropCanvasV18(canvas, 0.10, 0.35, 0.80, 0.30));

  const originals = attempts.slice();
  originals.forEach(c => attempts.push(highContrastV18(c)));
  originals.forEach(c => {
    attempts.push(rotateCanvasV18(c, 3));
    attempts.push(rotateCanvasV18(c, -3));
    attempts.push(rotateCanvasV18(c, 7));
    attempts.push(rotateCanvasV18(c, -7));
  });

  return attempts;
}

function cloneCanvasV18(canvas){
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  c.getContext("2d").drawImage(canvas,0,0);
  return c;
}

function cropCanvasV18(canvas, x, y, w, h){
  const sx = Math.floor(canvas.width*x);
  const sy = Math.floor(canvas.height*y);
  const sw = Math.floor(canvas.width*w);
  const sh = Math.floor(canvas.height*h);
  const c = document.createElement("canvas");
  c.width = Math.max(1000, sw*2);
  c.height = Math.max(350, sh*2);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function highContrastV18(canvas){
  const c = cloneCanvasV18(canvas);
  const ctx = c.getContext("2d");
  const img = ctx.getImageData(0,0,c.width,c.height);
  const d = img.data;
  for(let i=0;i<d.length;i+=4){
    const gray = 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const v = gray > 135 ? 255 : 0;
    d[i]=v; d[i+1]=v; d[i+2]=v;
  }
  ctx.putImageData(img,0,0);
  return c;
}

function rotateCanvasV18(canvas, degrees){
  const rad = degrees*Math.PI/180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const w = canvas.width;
  const h = canvas.height;
  const nw = Math.ceil(w*cos + h*sin);
  const nh = Math.ceil(w*sin + h*cos);
  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0,0,nw,nh);
  ctx.translate(nw/2,nh/2);
  ctx.rotate(rad);
  ctx.drawImage(canvas,-w/2,-h/2);
  return c;
}

function decodeCanvasV18(canvas){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>{
      if(!blob){reject(new Error("Could not create scan image."));return;}

      const file = new File([blob], "barcode-photo.png", {type:"image/png"});
      const tempId = "photoDecodeReader";
      let temp = document.getElementById(tempId);
      if(!temp){
        temp = document.createElement("div");
        temp.id = tempId;
        temp.style.display = "none";
        document.body.appendChild(temp);
      }

      const qr = new Html5Qrcode(tempId);
      qr.scanFile(file, true)
        .then(result=>{
          try{qr.clear();}catch(err){}
          resolve(result);
        })
        .catch(err=>{
          try{qr.clear();}catch(e){}
          reject(err);
        });
    },"image/png");
  });
}

// Override old photo functions and bind once DOM is ready.
window.scanPhoto = scanPhotoV18;
window.scanPhotoImage = scanPhotoV18;
window.scanPhotoRobust = scanPhotoV18;

document.addEventListener("DOMContentLoaded", initPhotoModeV18);
