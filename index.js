// index.js — with Registered Count + Edit/Update

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
  try {
    setStatus("Loading models...");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("models"),
    ]);
    modelsLoaded = true;
    setStatus("Models loaded ✅");
  } catch (err) {
    console.error("Model load error", err);
    setStatus("Error loading models (see console)");
  }
}

/* ===== Enumerate cameras ===== */
async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  const dropdown = document.getElementById("cameraSelect");
  dropdown.innerHTML = "";

  if (videoDevices.length === 0) {
    dropdown.innerHTML = "<option>No camera found</option>";
    return;
  }

  videoDevices.forEach((device, i) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    const label = device.label || `Camera ${i + 1}`;
    option.textContent = /front|user/i.test(label)
      ? "Front Camera"
      : /back|rear|environment/i.test(label)
      ? "Back Camera"
      : label;
    dropdown.appendChild(option);
  });

  dropdown.onchange = async (e) => {
    const selectedId = e.target.value;
    await startCameraById(selectedId);
  };
}

/* ===== Start camera ===== */
async function startCameraById(deviceId) {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } },
  });
  currentStream = stream;
  activeCamera = deviceId;

  const video = document.getElementById("video");
  video.srcObject = stream;
  video.onloadedmetadata = () => {
    video.play().catch(() => {});
    resizeOverlay();
    const label =
      videoDevices.find((d) => d.deviceId === deviceId)?.label || "Camera";
    setStatus(`Camera active: ${label}`);
    document.getElementById("video-status").style.display = "none";
  };
}

async function startCamera() {
  await getVideoDevices();
  if (videoDevices.length === 0) return;
  const defaultDevice =
    videoDevices.find((d) => /back|rear|environment/i.test(d.label))?.deviceId ||
    videoDevices[0].deviceId;
  document.getElementById("cameraSelect").value = defaultDevice;
  await startCameraById(defaultDevice);
}

/* ===== Overlay Resize ===== */
function resizeOverlay() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  canvas.width = video.videoWidth || canvas.clientWidth;
  canvas.height = video.videoHeight || canvas.clientHeight;
}

/* ===== Init ===== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  switchMode("admin");
});

/* ===== Mode Switch ===== */
function switchMode(mode) {
  currentMode = mode;
  clearDetectionLoops();
  const c = document.getElementById("modeContent");

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register Parent</h3>
      <div id="userCount" class="count-text">Registered Parents: 0</div>

      <div class="form-group"><label>Name</label><input id="username" type="text" /></div>
      <div class="form-group"><label>Role</label>
        <select id="role">
          <option>Father</option><option>Mother</option>
          <option>Guardian</option><option>Other</option>
        </select>
      </div>
      <button id="registerBtn" disabled>Register</button>

      <h4>Registered List</h4>
      <ul id="userList"></ul>
    `;
    document
      .getElementById("registerBtn")
      .addEventListener("click", registerOrUpdateUser);
    document.getElementById("username").addEventListener("input", () => {
      const nameOk = document.getElementById("username").value.trim().length > 0;
      document.getElementById("registerBtn").disabled = !nameOk || !lastDetection;
    });
    loadUsers();
    startLiveDetection();
  } else if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div id="childSelection"></div>
    `;
    startRecognition();
  }
}

/* ===== Clear intervals ===== */
function clearDetectionLoops() {
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
}

/* ===== Detection Loop ===== */
function startLiveDetection() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const btn = document.getElementById("registerBtn");

  adminDetectInterval = setInterval(async () => {
    if (currentMode !== "admin" || !modelsLoaded || video.readyState < 2) return;
    const detection = await faceapi
      .detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 })
      )
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (detection) {
      const box = detection.detection.box;
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      lastDetection = detection;
      const namePresent = document.getElementById("username").value.trim().length > 0;
      btn.disabled = !namePresent ? true : false;
    } else {
      lastDetection = null;
      btn.disabled = true;
    }
  }, 400);
}

/* ===== Register / Update User ===== */
async function registerOrUpdateUser() {
  const name = document.getElementById("username").value.trim();
  const role = document.getElementById("role").value;
  if (!name || !lastDetection) return alert("Show your face and enter name.");

  const video = document.getElementById("video");
  const snap = document.createElement("canvas");
  snap.width = video.videoWidth;
  snap.height = video.videoHeight;
  snap.getContext("2d").drawImage(video, 0, 0);
  const photo = snap.toDataURL("image/png");

  const user = {
    id: editingUserId || Date.now().toString(),
    name,
    role,
    descriptor: Array.from(lastDetection.descriptor),
    photo,
  };

  await window.dbAPI.addUser(user);
  alert(editingUserId ? `Updated ${name}` : `Registered ${name}`);
  editingUserId = null;
  document.getElementById("registerBtn").textContent = "Register";
  document.getElementById("username").value = "";
  loadUsers();
}

/* ===== Load Users ===== */
async function loadUsers() {
  const users = await window.dbAPI.getAllUsers();
  const list = document.getElementById("userList");
  const count = document.getElementById("userCount");
  if (count) count.textContent = `Registered Parents: ${users.length}`;
  list.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><strong>${u.name}</strong> (${u.role})</div>
      <div class="action-buttons">
        <button class="edit-btn" onclick="editUser('${u.id}')">Edit</button>
        <button class="danger" onclick="deleteUser('${u.id}')">Delete</button>
      </div>
    `;
    list.appendChild(li);
  });
}

/* ===== Edit / Delete ===== */
async function editUser(id) {
  const users = await window.dbAPI.getAllUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return;
  document.getElementById("username").value = u.name;
  document.getElementById("role").value = u.role;
  editingUserId = u.id;
  document.getElementById("registerBtn").textContent = "Update";
  alert(`Edit mode: ${u.name}`);
}
async function deleteUser(id) {
  if (!confirm("Delete this user?")) return;
  await window.dbAPI.deleteUser(id);
  loadUsers();
}

/* ===== Recognition ===== */
async function startRecognition() {
  const users = await window.dbAPI.getAllUsers();
  if (!users.length) return;
  const labeled = users.map(
    (u) =>
      new faceapi.LabeledFaceDescriptors(u.name, [
        new Float32Array(u.descriptor),
      ])
  );
  const matcher = new faceapi.FaceMatcher(labeled, 0.6);
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");

  recognitionInterval = setInterval(async () => {
    if (currentMode !== "recognition" || !modelsLoaded || video.readyState < 2) return;
    const detection = await faceapi
      .detectSingleFace(
        video,
        new faceapi.Tiny
