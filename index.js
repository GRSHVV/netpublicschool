// index.js — with Parent, Child, and Link modules

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let lastDetection = null;
let editingUserId = null;

let videoDevices = [];
let activeCamera = null;

/* ===== Utility ===== */
function setStatus(msg) {
  const el = document.getElementById("statusMsg");
  if (el) el.textContent = msg;
  console.log("[STATUS]", msg);
}

/* ===== Load face-api models ===== */
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

/* ===== Start Camera ===== */
async function ensureCameraPermission() {
  await navigator.mediaDevices.getUserMedia({ video: true });
}
async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  const dropdown = document.getElementById("cameraSelect");
  dropdown.innerHTML = "";
  videoDevices.forEach((device, i) => {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    const label = device.label || `Camera ${i + 1}`;
    opt.textContent = label;
    dropdown.appendChild(opt);
  });
  dropdown.onchange = (e) => startCameraById(e.target.value);
}
async function startCameraById(deviceId) {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } },
  });
  currentStream = stream;
  const video = document.getElementById("video");
  video.srcObject = stream;
  video.onloadedmetadata = () => {
    video.play();
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
  c.width = v.videoWidth;
  c.height = v.videoHeight;
}

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  switchMode("admin");
});

/* ===== MODE SWITCH ===== */
function switchMode(mode) {
  currentMode = mode;
  clearIntervals();
  const c = document.getElementById("modeContent");

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
    detectFaceForParent();
    loadParents();
  }

  if (mode === "child") {
    c.innerHTML = `
      <h3>Register Child</h3>
      <div class="form-group"><label>Child Name</label><input id="childName" /></div>
      <div class="form-group"><label>Class</label><input id="childClass" /></div>
      <div class="form-group"><label>Section</label><input id="childSection" /></div>
      <button id="addChildBtn" class="primary">Add Child</button>
      <ul id="childList"></ul>
    `;
    document.getElementById("addChildBtn").addEventListener("click", addChild);
    loadChildren();
  }

  if (mode === "link") {
    c.innerHTML = `
      <h3>Link Parents and Children</h3>
      <div class="form-group">
        <label>Select Parent</label><select id="parentSelect"></select>
      </div>
      <div class="form-group">
        <label>Select Children</label><select id="childrenSelect" multiple></select>
      </div>
      <button id="linkBtn" class="primary">Link</button>
      <ul id="linkList"></ul>
    `;
    document.getElementById("linkBtn").addEventListener("click", linkParentChild);
    loadLinkData();
  }

  if (mode === "recognition") {
    c.innerHTML = `<h3>Recognition</h3><div id="childSelection"></div>`;
    startRecognition();
  }
}

/* ===== Clear Loops ===== */
function clearIntervals() {
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
}

/* ===== Parent Detection ===== */
function detectFaceForParent() {
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const ctx = o.getContext("2d");
  const btn = document.getElementById("registerBtn");

  adminDetectInterval = setInterval(async () => {
    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    ctx.clearRect(0, 0, o.width, o.height);
    if (det) {
      const b = det.detection.box;
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 3;
      ctx.strokeRect(b.x, b.y, b.width, b.height);
      lastDetection = det;
      const name = document.getElementById("username").value.trim();
      btn.disabled = !name;
    } else {
      lastDetection = null;
      btn.disabled = true;
    }
  }, 500);
}

/* ===== Parent Register ===== */
async function registerUser() {
  const name = document.getElementById("username").value.trim();
  const role = document.getElementById("role").value;
  if (!name || !lastDetection) return alert("Show face & enter name.");
  const desc = Array.from(lastDetection.descriptor);
  const u = { id: Date.now().toString(), name, role, descriptor: desc };
  await window.dbAPI.addUser(u);
  alert("Registered parent");
  loadParents();
}
async function loadParents() {
  const list = document.getElementById("userList");
  const p = await window.dbAPI.getAllUsers();
  list.innerHTML = "";
  p.forEach((x) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `<span>${x.name} (${x.role})</span>`;
    list.appendChild(li);
  });
}

/* ===== Child Register ===== */
async function addChild() {
  const name = document.getElementById("childName").value.trim();
  const cls = document.getElementById("childClass").value.trim();
  const sec = document.getElementById("childSection").value.trim();
  if (!name || !cls || !sec) return alert("Enter all details");
  const c = { id: Date.now().toString(), name, class: cls, section: sec };
  await window.dbAPI.addChild(c);
  alert("Child added");
  loadChildren();
}
async function loadChildren() {
  const list = document.getElementById("childList");
  const children = await window.dbAPI.getAllChildren();
  list.innerHTML = "";
  children.forEach((c) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.textContent = `${c.name} (${c.class}-${c.section})`;
    list.appendChild(li);
  });
}

/* ===== Link Parent-Child ===== */
async function loadLinkData() {
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const ps = document.getElementById("parentSelect");
  const cs = document.getElementById("childrenSelect");
  ps.innerHTML = "";
  cs.innerHTML = "";
  parents.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    ps.appendChild(o);
  });
  children.forEach((c) => {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = `${c.name} (${c.class}-${c.section})`;
    cs.appendChild(o);
  });
  loadLinks();
}
async function linkParentChild() {
  const p = document.getElementById("parentSelect").value;
  const cs = Array.from(document.getElementById("childrenSelect").selectedOptions).map(
    (o) => o.value
  );
  await window.dbAPI.linkParentChildren(p, cs);
  alert("Linked successfully");
  loadLinks();
}
async function loadLinks() {
  const list = document.getElementById("linkList");
  const links = await window.dbAPI.getAllLinks();
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  list.innerHTML = "";
  links.forEach((l) => {
    const parent = parents.find((p) => p.id === l.parentId);
    const kids = l.childrenIds.map((cid) => children.find((c) => c.id === cid)?.name);
    const li = document.createElement("li");
    li.className = "list-item";
    li.textContent = `${parent?.name} → ${kids.join(", ")}`;
    list.appendChild(li);
  });
}

/* ===== Recognition (placeholder) ===== */
async function startRecognition() {
  setStatus("Recognition started (future link to pickup audit)");
}

/* ===== Cleanup ===== */
window.addEventListener("beforeunload", () => {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  clearIntervals();
});
