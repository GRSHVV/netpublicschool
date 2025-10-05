// index.js — Smart Pickup System (Final Stable Version with lowercase normalization)
// =====================================================

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let videoDevices = [];
let currentDeviceId = null;
let lastDetection = null;
let lastDrawTime = 0;

/* =====================================================
   STATUS HELPER
===================================================== */
function setStatus(msg) {
  const el = document.getElementById("statusMsg");
  if (el) el.textContent = msg;
  console.log("[STATUS]", msg);
}

/* =====================================================
   CLEAR INTERVALS
===================================================== */
function clearIntervals() {
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
}

/* =====================================================
   LOAD MODELS
===================================================== */
async function loadModels() {
  setStatus("Loading models...");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
  ]);
  modelsLoaded = true;
  setStatus("Models loaded ✅");
}

/* =====================================================
   CAMERA HANDLING
===================================================== */
async function ensureCameraPermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert("Camera permission is required. Please enable it in browser settings.");
    throw err;
  }
}

async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  const select = document.getElementById("cameraSelect");
  select.innerHTML = "";
  videoDevices.forEach((device, i) => {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.textContent = device.label || `Camera ${i + 1}`;
    select.appendChild(opt);
  });
  if (!currentDeviceId && videoDevices.length) {
    const back = videoDevices.find((d) => /back|rear|environment/i.test(d.label));
    currentDeviceId = back ? back.deviceId : videoDevices[0].deviceId;
  }
  select.value = currentDeviceId || "";
  select.onchange = async (e) => {
    const newId = e.target.value;
    const text = e.target.options[e.target.selectedIndex].text.toLowerCase();
    const isBack = /back|rear|environment/.test(text);
    await switchCamera(newId, isBack);
  };
}

async function startCamera() {
  await ensureCameraPermission();
  await getVideoDevices();
  await switchCamera(currentDeviceId, false);
}

async function switchCamera(deviceId, preferBack = false) {
  try {
    if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
    let constraints;
    if (preferBack)
      constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    else if (deviceId)
      constraints = { video: { deviceId: { exact: deviceId } }, audio: false };
    else constraints = { video: true, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = document.getElementById("video");
    v.srcObject = stream;
    currentStream = stream;
    currentDeviceId = deviceId || currentDeviceId;
    v.onloadedmetadata = () => {
      v.play();
      resizeOverlay();
      setStatus(`🎥 Camera Active`);
    };
  } catch (err) {
    console.error("switchCamera error:", err);
    alert("Failed to access selected camera.");
  }
}

function resizeOverlay() {
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  if (!v || !o) return;
  o.width = v.videoWidth || v.offsetWidth;
  o.height = v.videoHeight || v.offsetHeight;
}

/* =====================================================
   INIT
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  bindMenuButtons();
  window.addEventListener("resize", resizeOverlay);
});

/* =====================================================
   MENU
===================================================== */
function bindMenuButtons() {
  document.getElementById("btnAdmin")?.addEventListener("click", () => switchMode("admin"));
  document.getElementById("btnChild")?.addEventListener("click", () => switchMode("child"));
  document.getElementById("btnClass")?.addEventListener("click", () => switchMode("class"));
  document.getElementById("btnLink")?.addEventListener("click", () => switchMode("link"));
  document.getElementById("btnRecognition")?.addEventListener("click", () => switchMode("recognition"));
  document.getElementById("btnStartCamera")?.addEventListener("click", () => startCamera());
  document.getElementById("btnRefreshDevices")?.addEventListener("click", () => getVideoDevices());
}

/* =====================================================
   MODE SWITCH
===================================================== */
function switchMode(mode) {
  currentMode = mode;
  clearIntervals();
  const content = document.getElementById("modeContent");
  const cameraArea = document.getElementById("cameraArea");
  if (!content) return;
  if (["child", "class"].includes(mode)) cameraArea.classList.add("camera-hidden");
  else cameraArea.classList.remove("camera-hidden");
  if (mode === "admin") renderAdmin(content);
  if (mode === "child") renderChild(content);
  if (mode === "class") renderClass(content);
  if (mode === "link") renderLink(content);
  if (mode === "recognition") renderRecognition(content);
}

/* =====================================================
   ADMIN MODE (PARENT REGISTRATION)
===================================================== */
function renderAdmin(content) {
  content.innerHTML = `
    <h3>Register Parent</h3>
    <label>Name</label><input id="username" placeholder="name"/>
    <label>Role</label><select id="role"><option>father</option><option>mother</option><option>guardian</option></select>
    <button id="registerBtn" class="primary" disabled>Register</button>
    <ul id="userList"></ul>`;
  document.getElementById("registerBtn")?.addEventListener("click", registerUser);
  detectParentFace();
  loadParents();
}

function detectParentFace() {
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const ctx = o.getContext("2d");
  const btn = document.getElementById("registerBtn");
  adminDetectInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    o.width = v.videoWidth; o.height = v.videoHeight;
    const det = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
      .withFaceLandmarks().withFaceDescriptor();
    ctx.clearRect(0, 0, o.width, o.height);
    if (det) {
      const resized = faceapi.resizeResults(det, { width: o.width, height: o.height });
      faceapi.draw.drawDetections(o, resized);
      lastDetection = det; lastDrawTime = Date.now();
      btn.disabled = !document.getElementById("username").value.trim();
    } else if (Date.now() - lastDrawTime > 3000) {
      ctx.clearRect(0, 0, o.width, o.height); lastDetection = null; btn.disabled = true;
    }
  }, 300);
}

async function registerUser() {
  const name = document.getElementById("username").value.trim().toLowerCase();
  const role = document.getElementById("role").value.toLowerCase();
  if (!name || !lastDetection) return alert("Face not detected or name missing!");
  const desc = Array.from(lastDetection.descriptor);
  await window.dbAPI.addUser({ id: Date.now().toString(), name, role, descriptor: desc });
  alert("Parent registered.");
  loadParents();
}

async function loadParents() {
  const list = document.getElementById("userList");
  const users = await window.dbAPI.getAllUsers();
  list.innerHTML = users.length
    ? users.map((u) => `<li>${u.name} (${u.role})</li>`).join("")
    : "<li>No parents registered.</li>";
}

/* =====================================================
   CHILD REGISTRATION
===================================================== */
function renderChild(content) {
  content.innerHTML = `
    <h3>Register Child</h3>
    <label>Name</label><input id="childName" placeholder="name"/>
    <label>Class</label><select id="childClass"></select>
    <label>Section</label><select id="childSection"></select>
    <button id="addChildBtn" class="primary">Add Child</button>
    <ul id="childList"></ul>`;
  document.getElementById("addChildBtn")?.addEventListener("click", addChild);
  loadClassSectionOptions("childClass", "childSection");
  loadChildren();
}

async function addChild() {
  const name = document.getElementById("childName").value.trim().toLowerCase();
  const cls = document.getElementById("childClass").value.toLowerCase();
  const sec = document.getElementById("childSection").value.toLowerCase();
  if (!name || !cls || !sec) return alert("Fill all fields.");
  await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
  loadChildren();
}

async function loadChildren() {
  const kids = await window.dbAPI.getAllChildren();
  document.getElementById("childList").innerHTML = kids.length
    ? kids.map((c) => `<li>${c.name} (${c.class}-${c.section})</li>`).join("")
    : "<li>No children registered.</li>";
}

/* =====================================================
   CLASS & SECTION
===================================================== */
function renderClass(content) {
  content.innerHTML = `
    <h3>Manage Classes & Sections</h3>
    <label>Add Class</label><input id="className" placeholder="e.g. 10th"/><button id="addClassBtn">Add</button>
    <ul id="classList"></ul><hr/>
    <label>Add Section</label><input id="sectionName" placeholder="e.g. a"/><button id="addSectionBtn">Add</button>
    <ul id="sectionList"></ul>`;
  document.getElementById("addClassBtn")?.addEventListener("click", addClass);
  document.getElementById("addSectionBtn")?.addEventListener("click", addSection);
  loadClassList(); loadSectionList();
}

async function addClass() {
  const name = document.getElementById("className").value.trim().toLowerCase();
  if (!name) return;
  await window.dbAPI.addClass(name); loadClassList();
}

async function addSection() {
  const name = document.getElementById("sectionName").value.trim().toLowerCase();
  if (!name) return;
  await window.dbAPI.addSection(name); loadSectionList();
}

async function loadClassList() {
  const list = await window.dbAPI.getAllClasses();
  document.getElementById("classList").innerHTML = list.length
    ? list.map((x) => `<li>${x.name}</li>`).join("") : "<li>No classes.</li>";
}

async function loadSectionList() {
  const list = await window.dbAPI.getAllSections();
  document.getElementById("sectionList").innerHTML = list.length
    ? list.map((x) => `<li>${x.name}</li>`).join("") : "<li>No sections.</li>";
}

async function loadClassSectionOptions(cid, sid) {
  const cs = await window.dbAPI.getAllClasses();
  const ss = await window.dbAPI.getAllSections();
  document.getElementById(cid).innerHTML = cs.map((c) => `<option>${c.name}</option>`).join("");
  document.getElementById(sid).innerHTML = ss.map((s) => `<option>${s.name}</option>`).join("");
}

/* =====================================================
   LINK MODE
===================================================== */
function renderLink(content) {
  content.innerHTML = `
    <h3>Link Parent–Child</h3>
    <label>Parent</label><input id="parentSearch" placeholder="min 3 letters"/>
    <select id="parentSelect"></select>
    <label>Child</label><input id="childSearch" placeholder="min 3 letters"/>
    <select id="childrenSelect" multiple></select>
    <button id="linkBtn">Link</button><ul id="linkList"></ul>`;
  setupLinkSearch();
  document.getElementById("linkBtn")?.addEventListener("click", linkParentChild);
  loadLinks();
}

function setupLinkSearch() {
  const ps = document.getElementById("parentSearch");
  const cs = document.getElementById("childSearch");
  ps.oninput = async () => {
    const term = ps.value.toLowerCase();
    const parents = await window.dbAPI.getAllUsers();
    const sel = document.getElementById("parentSelect");
    sel.innerHTML = "";
    if (term.length >= 3)
      parents.filter((p) => p.name.startsWith(term)).forEach((p) => {
        const o = document.createElement("option");
        o.value = p.id; o.textContent = `${p.name} (${p.role})`; sel.appendChild(o);
      });
  };
  cs.oninput = async () => {
    const term = cs.value.toLowerCase();
    const children = await window.dbAPI.getAllChildren();
    const sel = document.getElementById("childrenSelect");
    sel.innerHTML = "";
    if (term.length >= 3)
      children.filter((c) => c.name.startsWith(term)).forEach((c) => {
        const o = document.createElement("option");
        o.value = c.id; o.textContent = `${c.name} (${c.class}-${c.section})`; sel.appendChild(o);
      });
  };
}

async function linkParentChild() {
  const pid = document.getElementById("parentSelect").value;
  const childIds = Array.from(document.getElementById("childrenSelect").selectedOptions).map((o) => o.value);
  if (!pid || !childIds.length) return alert("Select a parent and child.");
  await window.dbAPI.linkParentChildren(pid, childIds);
  loadLinks();
}

async function loadLinks() {
  const links = await window.dbAPI.getAllLinks();
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  document.getElementById("linkList").innerHTML = links
    .map((l) => {
      const p = parents.find((x) => x.id === l.parentId);
      const kids = l.childrenIds.map((cid) => {
        const c = children.find((ch) => ch.id === cid);
        return c ? `${c.name} (${c.class}-${c.section})` : "";
      }).join(", ");
      return `<li><strong>${p?.name}</strong> → ${kids}</li>`;
    })
    .join("");
}

/* =====================================================
   RECOGNITION
===================================================== */
async function renderRecognition(content) {
  content.innerHTML = `<h3>Recognition</h3><div id="recognitionResult"></div>`;
  const back = videoDevices.find((d) => /back|rear|environment/i.test((d.label || "").toLowerCase()));
  if (back) await switchCamera(back.deviceId, true);
  startRecognition();
}

async function startRecognition() {
  const users = await window.dbAPI.getAllUsers();
  const links = await window.dbAPI.getAllLinks();
  const children = await window.dbAPI.getAllChildren();
  if (!users.length) return setStatus("⚠️ No parents found.");
  const labeled = users.map((u) => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)]));
  const matcher = new faceapi.FaceMatcher(labeled, 0.6);
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const ctx = o.getContext("2d");
  const resultBox = document.getElementById("recognitionResult");
  recognitionInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    o.width = v.videoWidth; o.height = v.videoHeight;
    const det = await faceapi.detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
      .withFaceLandmarks().withFaceDescriptor();
    ctx.clearRect(0, 0, o.width, o.height);
    if (!det) return;
    const resized = faceapi.resizeResults(det, { width: o.width, height: o.height });
    const best = matcher.findBestMatch(det.descriptor);
    const box = resized.detection.box;
    if (best.label === "unknown") {
      ctx.strokeStyle = "red"; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);
      resultBox.innerHTML = `<p style='color:red'>❌ Unrecognized face</p>`;
    } else {
      ctx.strokeStyle = "green"; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);
      const parent = users.find((u) => u.name === best.label);
      const link = links.find((l) => l.parentId === parent?.id);
      const kidsHtml = (link?.childrenIds || []).map((cid) => {
        const ch = children.find((c) => c.id === cid);
        return ch ? `<li>${ch.name} (${ch.class}-${ch.section})</li>` : "";
      }).join("");
      resultBox.innerHTML = `<p style='color:green'>✅ ${best.label}</p><ul>${kidsHtml}</ul>`;
    }
  }, 400);
}
