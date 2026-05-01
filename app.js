const STORAGE_KEYS={scriptUrl:"gasTankScriptUrl",defaultUser:"gasTankDefaultUser"};
const ADD_NEW_VALUE="__ADD_NEW__";
let tanks=[],scanner=null,lastScanned="",scanCooldown=false,isRefreshing=false;
const el=id=>document.getElementById(id);

document.addEventListener("DOMContentLoaded",()=>{bindEvents();loadSettings();refreshData();});

function on(id,event,fn){const node=el(id);if(node)node.addEventListener(event,fn);}

function bindEvents(){
  document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>showView(btn.dataset.view)));
  on("refreshBtn","click",refreshData);
  on("saveScriptUrlBtn","click",()=>saveScriptUrl(el("scriptUrlInput").value));
  on("settingsSaveUrlBtn","click",()=>saveScriptUrl(el("settingsScriptUrlInput").value));
  on("saveDefaultUserBtn","click",saveDefaultUser);
  on("searchInput","input",renderResults);
  on("gasFilter","change",renderResults);
  on("statusFilter","change",renderResults);
  on("roomFilter","change",renderResults);
  on("addGasSelect","change",()=>toggleAddNewInput("addGasSelect","addGasNew"));
  on("addRoomSelect","change",()=>{toggleAddNewInput("addRoomSelect","addRoomNew");populatePositionSelectFor("addRoomSelect","addRoomNew","addPositionSelect","addPositionNew");});
  on("addRoomNew","input",()=>populatePositionSelectFor("addRoomSelect","addRoomNew","addPositionSelect","addPositionNew"));
  on("addPositionSelect","change",()=>toggleAddNewInput("addPositionSelect","addPositionNew"));
  document.querySelectorAll(".quick-filters button").forEach(btn=>btn.addEventListener("click",()=>{if(el("statusFilter"))el("statusFilter").value=btn.dataset.status;renderResults();}));
  on("startScanBtn","click",startScanner);
  on("stopScanBtn","click",stopScanner);
  on("manualLookupBtn","click",()=>handleBarcode(el("manualBarcodeInput").value.trim()));
  on("addTankBtn","click",addTankFromForm);
  on("downloadCsvBtn","click",downloadCsv);
}

function loadSettings(){
  const url=localStorage.getItem(STORAGE_KEYS.scriptUrl)||"",user=localStorage.getItem(STORAGE_KEYS.defaultUser)||"";
  if(el("scriptUrlInput"))el("scriptUrlInput").value=url;
  if(el("settingsScriptUrlInput"))el("settingsScriptUrlInput").value=url;
  if(el("defaultUserInput"))el("defaultUserInput").value=user;
  if(el("addUpdatedBy"))el("addUpdatedBy").value=user;
  updateConnectionStatus();
}

function getScriptUrl(){return localStorage.getItem(STORAGE_KEYS.scriptUrl)||"";}
function saveScriptUrl(url){
  url=(url||"").trim();
  if(!url){showToast("Paste the Apps Script Web App URL first.");return;}
  localStorage.setItem(STORAGE_KEYS.scriptUrl,url);
  if(el("scriptUrlInput"))el("scriptUrlInput").value=url;
  if(el("settingsScriptUrlInput"))el("settingsScriptUrlInput").value=url;
  updateConnectionStatus();refreshData();showToast("Connection saved.");
}
function saveDefaultUser(){
  const user=el("defaultUserInput").value.trim();
  localStorage.setItem(STORAGE_KEYS.defaultUser,user);
  if(el("addUpdatedBy"))el("addUpdatedBy").value=user;
  showToast("Initials saved.");
}
function getDefaultUser(){return localStorage.getItem(STORAGE_KEYS.defaultUser)||"";}
function updateConnectionStatus(message=""){
  const hasUrl=!!getScriptUrl();
  if(el("setupCard"))el("setupCard").classList.toggle("hidden",hasUrl);
  if(el("connectionStatus"))el("connectionStatus").textContent=message||(hasUrl?"Connected to Google Sheet":"Paste Apps Script URL to connect");
}

function normalizeBarcode(value){
  return String(value||"")
    .trim()
    .replace(/\s+/g,"")
    .replace(/[\u200B-\u200D\uFEFF]/g,"");
}

function api(action,payload={}){
  return new Promise((resolve,reject)=>{
    const url=getScriptUrl();
    if(!url){reject(new Error("Missing Apps Script URL."));return;}
    const callbackName="jsonp_callback_"+Date.now()+"_"+Math.floor(Math.random()*100000);
    const params=new URLSearchParams({action,callback:callbackName,payload:JSON.stringify(payload)});
    const script=document.createElement("script");
    window[callbackName]=function(data){
      delete window[callbackName];
      if(script.parentNode)script.parentNode.removeChild(script);
      if(!data||!data.ok)reject(new Error((data&&data.error)||"Unknown Apps Script error."));
      else resolve(data);
    };
    script.src=`${url}?${params.toString()}`;
    script.onerror=function(){
      delete window[callbackName];
      if(script.parentNode)script.parentNode.removeChild(script);
      reject(new Error("Connection failed. Check Apps Script deployment and account permissions."));
    };
    document.body.appendChild(script);
  });
}

async function refreshData({silent=false}={}){
  if(!getScriptUrl()){renderResults();return;}
  if(isRefreshing)return;
  isRefreshing=true;
  if(!silent)updateConnectionStatus("Refreshing...");
  try{
    const data=await api("list");
    tanks=(data.tanks||[]).map(t=>({...t,"Barcode":normalizeBarcode(t["Barcode"]),"Tank ID":normalizeBarcode(t["Tank ID"]||t["Barcode"])}));
    if(!silent)updateConnectionStatus(`Loaded ${tanks.length} current tanks`);
    populateAllOptions();renderResults();
  }catch(err){
    if(!silent)updateConnectionStatus("Connection error");
    showToast(err.message);
  }finally{
    isRefreshing=false;
  }
}

function populateAllOptions(){
  if(el("gasFilter"))fillSelect(el("gasFilter"),"All gases",uniqueValues("Gas"),false);
  if(el("roomFilter"))fillSelect(el("roomFilter"),"All rooms",uniqueValues("Room"),false);
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

function uniqueValues(key){return[...new Set(tanks.map(t=>(t[key]||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
function positionsForRoom(room){
  const normalized=(room||"").trim().toLowerCase();
  const positions=tanks.filter(t=>!normalized||(t["Room"]||"").trim().toLowerCase()===normalized).map(t=>(t["Position"]||"").trim()).filter(Boolean);
  return[...new Set(positions)].sort((a,b)=>a.localeCompare(b));
}
function selectedOrNew(selectId,newInputId){
  const select=el(selectId),input=el(newInputId);
  if(!select)return"";
  return select.value===ADD_NEW_VALUE?(input?input.value.trim():""):select.value.trim();
}
function fillSelect(select,placeholder,values,includeAddNew){
  if(!select)return;
  const current=select.value;
  select.innerHTML="";
  const first=document.createElement("option");
  first.value="";
  first.textContent=placeholder;
  select.appendChild(first);
  values.forEach(v=>{const option=document.createElement("option");option.value=v;option.textContent=v;select.appendChild(option);});
  if(includeAddNew){
    const add=document.createElement("option");
    add.value=ADD_NEW_VALUE;
    add.textContent="Add new...";
    select.appendChild(add);
  }
  if([...select.options].some(o=>o.value===current))select.value=current;
}
function toggleAddNewInput(selectId,inputId,focus=true){
  const select=el(selectId),input=el(inputId);
  if(!select||!input)return;
  const isAdd=select.value===ADD_NEW_VALUE;
  input.classList.toggle("hidden",!isAdd);
  if(isAdd&&focus)setTimeout(()=>input.focus(),0);
}
function populatePositionSelectFor(roomSelectId,roomNewId,positionSelectId,positionNewId){
  const room=selectedOrNew(roomSelectId,roomNewId);
  const current=el(positionSelectId)?el(positionSelectId).value:"";
  fillSelect(el(positionSelectId),"Select position",positionsForRoom(room),true);
  if(el(positionSelectId)&&[...el(positionSelectId).options].some(o=>o.value===current))el(positionSelectId).value=current;
  toggleAddNewInput(positionSelectId,positionNewId,false);
}

function renderResults(){
  if(!el("tankResults"))return;
  const query=el("searchInput")?el("searchInput").value.trim().toLowerCase():"";
  const gas=el("gasFilter")?el("gasFilter").value:"";
  const status=el("statusFilter")?el("statusFilter").value:"";
  const room=el("roomFilter")?el("roomFilter").value:"";
  const filtered=tanks.filter(t=>{
    const haystack=[t["Barcode"],t["Tank ID"],t["Gas"],t["Room"],t["Position"],t["Status"],t["Updated By"]].join(" ").toLowerCase();
    return(!query||haystack.includes(query))&&(!gas||t["Gas"]===gas)&&(!status||t["Status"]===status)&&(!room||t["Room"]===room);
  });
  if(el("resultsSummary"))el("resultsSummary").textContent=`${filtered.length} tank${filtered.length===1?"":"s"} found`;
  el("tankResults").innerHTML=filtered.map(tankCardHtml).join("")||emptyState("No tanks match that search.");
  document.querySelectorAll("[data-update-barcode]").forEach(btn=>btn.addEventListener("click",()=>updateTankStatus(btn.dataset.updateBarcode,btn.dataset.status)));
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
function statusToClass(status){if(status==="In Use")return"InUse";if(status==="Empty")return"Empty";return"New";}

function locallyApplyUpdate(barcode,updates,eventType="update"){
  barcode=normalizeBarcode(barcode);
  const index=tanks.findIndex(t=>normalizeBarcode(t["Barcode"])===barcode);
  const now=new Date().toISOString();
  if(index<0)return;
  tanks[index]={...tanks[index],...updates,"Barcode":barcode,"Tank ID":barcode,"Last Modified":now,"Event Type":eventType,"Event ID":"local-"+Date.now()};
  if(updates["Status"]==="In Use")tanks[index]["Date Set In Use"]=now;
  if(updates["Status"]==="Empty")tanks[index]["Date Emptied"]=now;
  renderResults();populateAllOptions();
}

async function updateTankStatus(barcode,status){
  barcode=normalizeBarcode(barcode);
  const updatedBy=getDefaultUser()||prompt("Your initials?")||"";
  locallyApplyUpdate(barcode,{"Status":status,"Updated By":updatedBy},"status");
  showToast(`Saving ${status}...`);
  try{await api("updateStatus",{barcode,status,updatedBy});showToast(`Marked ${status}.`);await refreshData();}
  catch(err){showToast(err.message);await refreshData();}
}

function showView(viewId){
  document.querySelectorAll(".tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.view===viewId));
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active",view.id===viewId));
}

function startScanner(){
  if(!window.Html5QrcodeScanner){showToast("Scanner library did not load. Check internet connection.");return;}
  if(scanner){showToast("Scanner is already open.");return;}
  if(!el("reader")){showToast("Scanner area not found.");return;}
  el("reader").classList.remove("hidden");
  if(el("startScanBtn"))el("startScanBtn").classList.add("hidden");
  if(el("stopScanBtn"))el("stopScanBtn").classList.remove("hidden");
  scanner=new Html5QrcodeScanner("reader",{fps:10,qrbox:{width:280,height:160},rememberLastUsedCamera:true,supportedScanTypes:[Html5QrcodeScanType.SCAN_TYPE_CAMERA],formatsToSupport:[Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.CODE_93,Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.UPC_E,Html5QrcodeSupportedFormats.QR_CODE],videoConstraints:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080},focusMode:"continuous"}},false);
  scanner.render(decodedText=>{
    const normalized=normalizeBarcode(decodedText);
    if(scanCooldown||normalized===lastScanned)return;
    scanCooldown=true;lastScanned=normalized;
    handleBarcode(normalized);
    showToast("✅ Barcode scanned. Form opened below.");
    setTimeout(()=>{scanCooldown=false;lastScanned="";},2500);
  });
}

async function stopScanner(){
  if(scanner){try{await scanner.clear();}catch(err){console.warn(err);}scanner=null;}
  if(el("reader"))el("reader").classList.add("hidden");
  if(el("startScanBtn"))el("startScanBtn").classList.remove("hidden");
  if(el("stopScanBtn"))el("stopScanBtn").classList.add("hidden");
}

async function handleBarcode(rawBarcode){
  if(isSaving){
    showToast("Still saving the previous tank. Try again in a second.");
    return;
  }

  const raw=String(rawBarcode||"").trim();
  const barcode=normBarcode(rawBarcode);

  if(!barcode){
    showToast("No barcode entered.");
    return;
  }

  if(!el("scanResult")){
    showToast("Scan result area not found.");
    return;
  }

  showToast("Checking barcode...");

  try{
    let found=tanks.find(t=>normBarcode(t["Barcode"])===barcode || normBarcode(t["Tank ID"])===barcode);

    if(getScriptUrl()){
      try{
        const data=await api("lookup",{barcode:raw, normalizedBarcode:barcode});
        if(data && data.tank){
          found=data.tank;
          const index=tanks.findIndex(t=>normBarcode(t["Barcode"])===barcode || normBarcode(t["Tank ID"])===barcode);
          if(index>=0)tanks[index]=found;
          else tanks.push(found);
          populateAllOptions();
          renderResults();
        }
      }catch(err){
        console.warn("Lookup failed:",err);
        showToast("Lookup failed. Using loaded tank list.");
      }
    }

    if(found){
      showToast("✅ Existing tank found.");
      renderKnownTankUpdate(found);
    }else{
      showToast("No match found. Opening new tank form.");
      renderNewTankSetup(raw);
    }
  }catch(err){
    console.error(err);
    el("scanResult").innerHTML=`
      <div class="card warning">
        <h2>Scan handled, but form failed to open</h2>
        <p><b>Scanned:</b> ${escapeHtml(raw)}</p>
        <p>${escapeHtml(err.message || String(err))}</p>
        <button id="forceNewTankBtn">Open new tank form</button>
      </div>`;
    on("forceNewTankBtn","click",()=>renderNewTankSetup(raw));
    showToast("Form error. See message below.");
  }

  setTimeout(()=>scrollToEl("scanResult"),100);
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
    <input id="${newInputId}" class="${currentValue&&!hasCurrent?"":"hidden"} add-new-input" value="${escapeAttr(inputValue)}" placeholder="Type new ${fieldName.toLowerCase()}" />
  `;
}

function renderKnownTankUpdate(t){
  if(!el("scanResult"))return;
  el("scanResult").dataset.saved="false";
  const gases=uniqueValues("Gas"),rooms=uniqueValues("Room"),positions=positionsForRoom(t["Room"]);
  el("scanResult").innerHTML=`
    <div class="card success">
      <div class="scan-banner">✅ Existing tank found</div>
      <h2>Update tank</h2>
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
        <button id="scanAgainBtn" class="secondary">Clear form</button>
      </div>
    </div>`;
  on("updateGasSelect","change",()=>toggleAddNewInput("updateGasSelect","updateGasNew"));
  on("updateRoomSelect","change",()=>{toggleAddNewInput("updateRoomSelect","updateRoomNew");populatePositionSelectFor("updateRoomSelect","updateRoomNew","updatePositionSelect","updatePositionNew");});
  on("updateRoomNew","input",()=>populatePositionSelectFor("updateRoomSelect","updateRoomNew","updatePositionSelect","updatePositionNew"));
  on("updatePositionSelect","change",()=>toggleAddNewInput("updatePositionSelect","updatePositionNew"));
  toggleAddNewInput("updateGasSelect","updateGasNew",false);
  toggleAddNewInput("updateRoomSelect","updateRoomNew",false);
  toggleAddNewInput("updatePositionSelect","updatePositionNew",false);
  on("saveScannedUpdateBtn","click",async()=>{
    const updatedBy=el("updateUpdatedBy").value.trim();
    if(updatedBy){localStorage.setItem(STORAGE_KEYS.defaultUser,updatedBy);if(el("defaultUserInput"))el("defaultUserInput").value=updatedBy;if(el("addUpdatedBy"))el("addUpdatedBy").value=updatedBy;}
    const barcode=normalizeBarcode(t["Barcode"]);
    const updates={"Gas":selectedOrNew("updateGasSelect","updateGasNew"),"Room":selectedOrNew("updateRoomSelect","updateRoomNew"),"Position":selectedOrNew("updatePositionSelect","updatePositionNew"),"Status":el("updateStatus").value,"Updated By":updatedBy};
    if(!updates["Gas"]||!updates["Room"]||!updates["Position"]){showToast("Gas, room, and position are required.");return;}
    locallyApplyUpdate(barcode,updates,"update");showToast("Saving update...");
    try{await api("updateFull",{barcode,tank:updates});showToast("Tank updated.");await refreshData();el("scanResult").innerHTML=emptyState("Saved. Keep scanning or stop the scanner when done.");scrollToEl("cameraCard");}
    catch(err){showToast(err.message);await refreshData();}
  });
  on("scanAgainBtn","click",()=>{el("scanResult").innerHTML="";});
}

function renderNewTankSetup(barcode){
  barcode=normalizeBarcode(barcode);
  if(!el("scanResult"))return;
  el("scanResult").dataset.saved="false";
  el("scanResult").innerHTML=`
    <div class="card success">
      <div class="scan-banner">✅ New barcode scanned</div>\n      <p><b>Scanned:</b> ${escapeHtml(barcode)}</p>
      <h2>New tank detected</h2>
      <p>This barcode is not in the shared inventory yet. The Tank ID will be the barcode.</p>
      <label>Barcode / Tank ID</label>
      <input id="newBarcode" value="${escapeAttr(barcode)}" readonly />
      ${buildValueSelect("Gas","newGasSelect","newGasNew",uniqueValues("Gas"),"","Select gas")}
      ${buildValueSelect("Room","newRoomSelect","newRoomNew",uniqueValues("Room"),"","Select room")}
      ${buildValueSelect("Position","newPositionSelect","newPositionNew",[],"","Select position")}
      <label>Status</label>
      <select id="newStatus"><option selected>New</option><option>In Use</option><option>Empty</option></select>
      <label>Updated by</label>
      <input id="newUpdatedBy" value="${escapeAttr(getDefaultUser())}" placeholder="Your initials" />
      <div class="scan-actions">
        <button id="saveNewTankBtn">Add new tank</button>
        <button id="scanAgainBtn" class="secondary">Clear form</button>
      </div>
    </div>`;
  on("newGasSelect","change",()=>toggleAddNewInput("newGasSelect","newGasNew"));
  on("newRoomSelect","change",()=>{toggleAddNewInput("newRoomSelect","newRoomNew");populatePositionSelectFor("newRoomSelect","newRoomNew","newPositionSelect","newPositionNew");});
  on("newRoomNew","input",()=>populatePositionSelectFor("newRoomSelect","newRoomNew","newPositionSelect","newPositionNew"));
  on("newPositionSelect","change",()=>toggleAddNewInput("newPositionSelect","newPositionNew"));
  toggleAddNewInput("newGasSelect","newGasNew",false);
  toggleAddNewInput("newRoomSelect","newRoomNew",false);
  toggleAddNewInput("newPositionSelect","newPositionNew",false);
  on("saveNewTankBtn","click",async()=>{
    const barcode=normalizeBarcode(el("newBarcode").value);
    const tank={"Barcode":barcode,"Tank ID":barcode,"Gas":selectedOrNew("newGasSelect","newGasNew"),"Room":selectedOrNew("newRoomSelect","newRoomNew"),"Position":selectedOrNew("newPositionSelect","newPositionNew"),"Status":el("newStatus").value,"Updated By":el("newUpdatedBy").value.trim()};
    if(!tank["Barcode"]||!tank["Gas"]||!tank["Room"]||!tank["Position"]){showToast("Barcode, gas, room, and position are required.");return;}
    if(tank["Updated By"]){localStorage.setItem(STORAGE_KEYS.defaultUser,tank["Updated By"]);if(el("defaultUserInput"))el("defaultUserInput").value=tank["Updated By"];if(el("addUpdatedBy"))el("addUpdatedBy").value=tank["Updated By"];}
    const now=new Date().toISOString();
    tanks.push({...tank,"Date Added":now,"Date Set In Use":tank["Status"]==="In Use"?now:"","Date Emptied":tank["Status"]==="Empty"?now:"","Last Modified":now,"Event Type":"add","Event ID":"local-"+Date.now()});
    if(isSaving){showToast("Already saving. Wait a second.");return;}
    isSaving=true;
    renderResults();populateAllOptions();showToast("Saving new tank...");
    try{
      await api("addTank",{tank});
      showToast("New tank added.");
      if(el("scanResult")){el("scanResult").dataset.saved="true";el("scanResult").innerHTML=emptyState("Saved. Keep scanning or stop the scanner when done.");}
      scrollToEl("cameraCard");
    }
    catch(err){
      showToast(err.message);
      await refreshData({preserveForm:true});
    }
    finally{
      isSaving=false;
    }
  });
  on("scanAgainBtn","click",()=>{el("scanResult").innerHTML="";});
}

async function addTankFromForm(){
  const barcode=normalizeBarcode(el("addBarcode").value);
  const tank={"Barcode":barcode,"Tank ID":barcode,"Gas":selectedOrNew("addGasSelect","addGasNew"),"Room":selectedOrNew("addRoomSelect","addRoomNew"),"Position":selectedOrNew("addPositionSelect","addPositionNew"),"Status":el("addStatus").value,"Updated By":el("addUpdatedBy").value.trim()||getDefaultUser()};
  if(!tank["Barcode"]||!tank["Gas"]||!tank["Room"]||!tank["Position"]){showToast("Barcode, gas, room, and position are required.");return;}
  if(tank["Updated By"]){localStorage.setItem(STORAGE_KEYS.defaultUser,tank["Updated By"]);if(el("defaultUserInput"))el("defaultUserInput").value=tank["Updated By"];}
  const now=new Date().toISOString();
  tanks.push({...tank,"Date Added":now,"Date Set In Use":tank["Status"]==="In Use"?now:"","Date Emptied":tank["Status"]==="Empty"?now:"","Last Modified":now,"Event Type":"add","Event ID":"local-"+Date.now()});
  if(isSaving){showToast("Already saving. Wait a second.");return;}
  isSaving=true;
  renderResults();populateAllOptions();showToast("Saving tank...");
  try{
    await api("addTank",{tank});
    showToast("Tank added.");
    clearAddForm();
    showView("scanView");
    scrollToEl("cameraCard");
  }
  catch(err){
    showToast(err.message);
    await refreshData({preserveForm:true});
  }
  finally{
    isSaving=false;
  }
}

function clearAddForm(){
  if(el("addBarcode"))el("addBarcode").value="";
  if(el("addGasNew"))el("addGasNew").value="";
  if(el("addRoomNew"))el("addRoomNew").value="";
  if(el("addPositionNew"))el("addPositionNew").value="";
  if(el("addGasSelect"))el("addGasSelect").value="";
  if(el("addRoomSelect"))el("addRoomSelect").value="";
  if(el("addPositionSelect"))el("addPositionSelect").value="";
  if(el("addStatus"))el("addStatus").value="New";
  if(el("addUpdatedBy"))el("addUpdatedBy").value=getDefaultUser();
  populateAddDropdowns();
}

function scrollToEl(id){const node=el(id);if(node)node.scrollIntoView({behavior:"smooth",block:"start"});}

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

function csvEscape(value){value=String(value);return/[",\n]/.test(value)?`"${value.replaceAll('"','""')}"`:value;}
function emptyState(message){return`<div class="card"><p>${escapeHtml(message)}</p></div>`;}
function showToast(message){
  if(!el("toast")){alert(message);return;}
  el("toast").textContent=message;el("toast").classList.remove("hidden");
  clearTimeout(window.toastTimeout);
  window.toastTimeout=setTimeout(()=>el("toast").classList.add("hidden"),3200);
}
function formatDate(value){if(!value)return"";const date=new Date(value);if(Number.isNaN(date.getTime()))return value;return date.toLocaleString();}
function escapeHtml(str){return String(str??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function escapeAttr(str){return escapeHtml(str).replaceAll("`","&#096;");}
