// index.js — updated to hide camera in Child Registration mode

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let lastDetection = null;
let videoDevices = [];

/* ===== Status ===== */
function setStatus(msg) {
  document.getElementById("statusMsg").textContent = msg;
  console.log("[STATUS]", msg);
}

/* ===== Models ===== */
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

/* ===== Camera ===== */
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
  v.onloadedmetadata = () => v.play();
}
async function startCamera() {
  await ensureCameraPermission();
  await getVideoDevices();
  const id = videoDevices[0]?.deviceId;
  if (id) await startCameraById(id);
}

/* ===== Initialize ===== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  switchMode("admin");
});

/* ===== Mode Switch ===== */
function switchMode(mode) {
  currentMode = mode;
  clearIntervals();
  const camera = document.getElementById("cameraArea");
  const c = document.getElementById("modeContent");

  if (mode === "child") {
    camera.classList.add("camera-hidden"); // hide camera
  } else {
    camera.classList.remove("camera-hidden");
  }

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
    detectParentFace();
    loadParents();
    document.getElementById("registerBtn").addEventListener("click", registerUser);
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
      <h3>Link Parents & Children</h3>
      <label>Parent</label><select id="parentSelect"></select>
      <label>Children</label><select id="childrenSelect" multiple></select>
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

/* ===== Face Detection ===== */
function detectParentFace() {
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
      btn.disabled = !document.getElementById("username").value.trim();
    } else {
      lastDetection = null;
      btn.disabled = true;
    }
  }, 400);
}

/* ===== DB Integration ===== */
async function registerUser() {
  const name = document.getElementById("username").value.trim();
  const role = document.getElementById("role").value;
  if (!name || !lastDetection) return alert("Show face & enter name.");
  const desc = Array.from(lastDetection.descriptor);
  const u = { id: Date.now().toString(), name, role, descriptor: desc };
  await window.dbAPI.addUser(u);
  alert("Parent registered!");
  loadParents();
}
async function loadParents() {
  const p = await window.dbAPI.getAllUsers();
  const list = document.getElementById("userList");
  list.innerHTML = p.map((x) => `<li class='list-item'>${x.name} (${x.role})</li>`).join("");
}
async function addChild() {
  const name = document.getElementById("childName").value.trim();
  const cls = document.getElementById("childClass").value.trim();
  const sec = document.getElementById("childSection").value.trim();
  if (!name || !cls || !sec) return alert("Enter all fields.");
  await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
  alert("Child added!");
  loadChildren();
}
async function loadChildren() {
  const c = await window.dbAPI.getAllChildren();
  const list = document.getElementById("childList");
  list.innerHTML = c.map((x) => `<li class='list-item'>${x.name} (${x.class}-${x.section})</li>`).join("");
}
async function loadLinkData() {
  const ps = document.getElementById("parentSelect");
  const cs = document.getElementById("childrenSelect");
  ps.innerHTML = "";
  cs.innerHTML = "";
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  parents.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name;
    ps.appendChild(o);
  });
  children.forEach((ch) => {
    const o = document.createElement("option");
    o.value = ch.id;
    o.textContent = `${ch.name} (${ch.class}-${ch.section})`;
    cs.appendChild(o);
  });
  loadLinks();
}
async function linkParentChild() {
  const pid = document.getElementById("parentSelect").value;
  const cs = Array.from(document.getElementById("childrenSelect").selectedOptions).map(
    (o) => o.value
  );
  await window.dbAPI.linkParentChildren(pid, cs);
  alert("Linked successfully!");
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
    const kids = l.childrenIds.map((cid) => c.find((ch) => ch.id === cid)?.name);
    const li = document.createElement("li");
    li.className = "list-item";
    li.textContent = `${par?.name} → ${kids.join(", ")}`;
    list.appendChild(li);
  });
}
async function startRecognition() {
  setStatus("Recognition ready (next: show linked children)");
}
