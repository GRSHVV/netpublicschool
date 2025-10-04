// index.js — Smart Pickup System
// With many-to-many parent-child linking and multiple children display in recognition

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let lastDetection = null;
let lastDrawTime = 0;
let videoDevices = [];

/* =====================================================
   STATUS HANDLER
===================================================== */
function setStatus(msg) {
  document.getElementById("statusMsg").textContent = msg;
  console.log("[STATUS]", msg);
}

/* =====================================================
   MODEL LOADING
===================================================== */
async function loadModels() {
  setStatus("Loading models...");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("models"),
  ]);
  modelsLoaded = true;
  setStatus("Models loaded ✅");
}

/* =====================================================
   CAMERA SETUP
===================================================== */
async function ensureCameraPermission() {
  await navigator.mediaDevices.getUserMedia({ video: true });
}

async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  const select = document.getElementById("cameraSelect");
  select.innerHTML = "";
  videoDevices.forEach((d, i) => {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || `Camera ${i + 1}`;
    select.appendChild(o);
  });
  select.onchange = (e) => startCameraById(e.target.value);
}

async function startCameraById(deviceId) {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } },
  });
  currentStream = stream;
  const v = document.getElementById("video");
  v.srcObject = stream;
  v.onloadedmetadata = () => {
    v.play();
    resizeOverlay();
  };
}

async function startCamera() {
  await ensureCameraPermission();
  await getVideoDevices();
  const id = videoDevices[0]?.deviceId;
  if (id) await startCameraById(id);
}

function resizeOverlay() {
  const v = document.getElementById("video");
  const c = document.getElementById("overlay");
  c.width = v.offsetWidth;
  c.height = v.offsetHeight;
}

/* =====================================================
   INITIALIZATION
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  resizeOverlay();
  switchMode("admin");
  window.addEventListener("resize", resizeOverlay);
});

/* =====================================================
   MODE SWITCHER
===================================================== */
function switchMode(mode) {
  currentMode = mode;
  clearIntervals();
  const camera = document.getElementById("cameraArea");
  const c = document.getElementById("modeContent");

  if (["child", "class"].includes(mode)) camera.classList.add("camera-hidden");
  else camera.classList.remove("camera-hidden");

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register Parent</h3>
      <div class="form-group"><label>Name</label><input id="username" /></div>
      <div class="form-group"><label>Role</label>
        <select id="role"><option>Father</option><option>Mother</option><option>Guardian</option></select>
      </div>
      <button id="registerBtn" class="primary" disabled>Register</button>
      <ul id="userList"></ul>
    `;
    document.getElementById("registerBtn").addEventListener("click", registerUser);
    detectParentFace();
    loadParents();
  }

  if (mode === "child") {
    c.innerHTML = `
      <h3>Register Child</h3>
      <div class="form-group"><label>Child Name</label><input id="childName" /></div>
      <div class="form-group"><label>Class</label><select id="childClass"></select></div>
      <div class="form-group"><label>Section</label><select id="childSection"></select></div>
      <button id="addChildBtn" class="primary">Add Child</button>
      <ul id="childList"></ul>
    `;
    loadClassSectionOptions("childClass", "childSection");
    document.getElementById("addChildBtn").addEventListener("click", addChild);
    loadChildren();
  }

  if (mode === "class") {
    c.innerHTML = `
      <h3>Manage Classes & Sections</h3>
      <div class="form-group"><label>Add Class</label>
        <input id="className" placeholder="e.g. 10th" />
        <button id="addClassBtn" class="primary">Add</button>
      </div>
      <ul id="classList"></ul>
      <hr>
      <div class="form-group"><label>Add Section</label>
        <input id="sectionName" placeholder="e.g. A" />
        <button id="addSectionBtn" class="primary">Add</button>
      </div>
      <ul id="sectionList"></ul>
    `;
    document.getElementById("addClassBtn").addEventListener("click", addClass);
    document.getElementById("addSectionBtn").addEventListener("click", addSection);
    loadClassList();
    loadSectionList();
  }

  if (mode === "link") {
    c.innerHTML = `
      <h3>Link Parents & Children</h3>
      <div class="form-group">
        <label>Search Parent (min 3 letters)</label>
        <input id="parentSearch" placeholder="Type parent name..." />
        <select id="parentSelect"></select>
      </div>
      <div class="form-group">
        <label>Filter Children</label>
        <select id="linkClass"></select>
        <select id="linkSection"></select>
      </div>
      <div class="form-group">
        <label>Search Child (min 3 letters)</label>
        <input id="childSearch" placeholder="Type child name..." />
        <select id="childrenSelect" multiple></select>
      </div>
      <button id="linkBtn" class="primary">Link</button>
      <ul id="linkList"></ul>
    `;
    loadClassSectionOptions("linkClass", "linkSection");
    setupLinkSearchHandlers();
    document.getElementById("linkBtn").addEventListener("click", linkParentChild);
    loadLinks();
  }

  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div id="recognitionResult" class="result-box"></div>
    `;
    startRecognition();
  }
}

/* =====================================================
   LINK MULTIPLE CHILDREN FIX
===================================================== */
async function linkParentChild() {
  const pid = document.getElementById("parentSelect").value;
  const cs = Array.from(document.getElementById("childrenSelect").selectedOptions).map(
    (o) => o.value
  );
  if (!pid || !cs.length) return alert("Select parent and at least one child.");
  await window.dbAPI.linkParentChildren(pid, cs);
  alert("✅ Linked successfully!");
  loadLinks();
}

async function loadLinks() {
  const list = document.getElementById("linkList");
  const links = await window.dbAPI.getAllLinks();
  const p = await window.dbAPI.getAllUsers();
  const c = await window.dbAPI.getAllChildren();
  list.innerHTML = "";
  links.forEach((l) => {
    const par = p.find((x) => x.id === l.parentId);
    const kids = l.childrenIds
      .map((cid) => {
        const child = c.find((ch) => ch.id === cid);
        return child ? `${child.name} (${child.class}-${child.section})` : "";
      })
      .join(", ");
    const li = document.createElement("li");
    li.className = "list-item";
    li.textContent = `${par?.name} → ${kids}`;
    list.appendChild(li);
  });
}
