// index.js — version with camera dropdown selector

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let lastDetection = null;

let videoDevices = [];
let activeCamera = null;

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

/* ===== Enumerate and list cameras ===== */
async function getVideoDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoDevices = devices.filter((d) => d.kind === "videoinput");
    console.log("🎥 Cameras detected:", videoDevices);

    const dropdown = document.getElementById("cameraSelect");
    dropdown.innerHTML = "";

    if (videoDevices.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No camera found";
      dropdown.appendChild(opt);
      return;
    }

    // Build options
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
  } catch (err) {
    console.error("enumerateDevices error", err);
  }
}

/* ===== Start camera by specific deviceId ===== */
async function startCameraById(deviceId) {
  try {
    if (currentStream) currentStream.getTracks().forEach((t) => t.stop());

    const constraints = deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: { facingMode: "environment" } };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
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
      const vs = document.getElementById("video-status");
      if (vs) vs.style.display = "none";
    };
  } catch (err) {
    console.error("startCameraById error", err);
    setStatus("Camera failed. Check permissions.");
  }
}

/* ===== Initialize first camera ===== */
async function startCamera() {
  await getVideoDevices();
  if (videoDevices.length === 0) return;

  const defaultDevice = videoDevices.find((d) =>
    /back|rear|environment/i.test(d.label)
  )
    ? videoDevices.find((d) =>
        /back|rear|environment/i.test(d.label)
      ).deviceId
    : videoDevices[0].deviceId;

  document.getElementById("cameraSelect").value = defaultDevice;
  await startCameraById(defaultDevice);
}

/* ===== Resize overlay ===== */
function resizeOverlay() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  if (!video || !canvas) return;
  canvas.width = video.videoWidth || canvas.clientWidth;
  canvas.height = video.videoHeight || canvas.clientHeight;
}

/* ===== Initialize app ===== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  switchMode("admin");
});

/* ===== Mode switching ===== */
function switchMode(mode) {
  currentMode = mode;
  clearDetectionLoops();
  const c = document.getElementById("modeContent");

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register User</h3>
      <div class="form-group"><label>Name</label><input id="username" type="text" /></div>
      <div class="form-group"><label>Role</label>
        <select id="role">
          <option>Father</option><option>Mother</option>
          <option>Guardian</option><option>Other</option>
        </select>
      </div>
      <button id="registerBtn" disabled>Register</button>
      <h4>Registered Users</h4><ul id="userList"></ul>
    `;
    document
      .getElementById("registerBtn")
      .addEventListener("click", registerFace);
    document.getElementById("username").addEventListener("input", () => {
      const nameOk = document.getElementById("username").value.trim().length > 0;
      const btn = document.getElementById("registerBtn");
      btn.disabled = !nameOk || !lastDetection;
    });
    loadUsers();
    startLiveDetection();
  }

  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div id="childSelection"></div>
    `;
    startRecognition();
  }
}

/* ===== Stop intervals ===== */
function clearDetectionLoops() {
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
}

/* ===== Live detection ===== */
function startLiveDetection() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const btn = document.getElementById("registerBtn");

  adminDetectInterval = setInterval(async () => {
    if (currentMode !== "admin" || !modelsLoaded || video.readyState < 2) return;

    let inputSize = 416;
    let threshold = 0.4;
    if (lastDetection) {
      const ratio = lastDetection.detection.box.width / video.videoWidth;
      if (ratio < 0.2) threshold = 0.3;
      if (ratio > 0.5) threshold = 0.5;
    }

    const detection = await faceapi
      .detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: threshold })
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

      const namePresent = document
        .getElementById("username")
        .value.trim().length > 0;
      btn.disabled = !namePresent ? true : false;
    } else {
      lastDetection = null;
      btn.disabled = true;
    }
  }, 400);
}

/* ===== Register Face ===== */
async function registerFace() {
  const name = document.getElementById("username").value.trim();
  const role = document.getElementById("role").value;
  if (!name || !lastDetection)
    return alert("Please show your face and enter name first.");

  const video = document.getElementById("video");
  const snap = document.createElement("canvas");
  snap.width = video.videoWidth;
  snap.height = video.videoHeight;
  snap.getContext("2d").drawImage(video, 0, 0);
  const photo = snap.toDataURL("image/png");

  const user = {
    id: Date.now().toString(),
    name,
    role,
    descriptor: Array.from(lastDetection.descriptor),
    photo,
  };

  await window.dbAPI.addUser(user);
  alert(`Registered ${name}`);
  loadUsers();
}

/* ===== Load Users ===== */
async function loadUsers() {
  const users = await window.dbAPI.getAllUsers();
  const list = document.getElementById("userList");
  list.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${u.name} (${u.role})</span>
      <button class="danger" onclick="window.dbAPI.deleteUser('${u.id}').then(loadUsers)">Delete</button>
    `;
    list.appendChild(li);
  });
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
    if (currentMode !== "recognition" || !modelsLoaded || video.readyState < 2)
      return;

    const detection = await faceapi
      .detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
      )
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detection) {
      const box = detection.detection.box;
      ctx.strokeStyle = "green";
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      const match = matcher.findBestMatch(detection.descriptor);
      document.getElementById("childSelection").innerHTML =
        match.label === "unknown"
          ? "<p style='color:red'>❌ Unknown Face</p>"
          : `<p>✅ Recognized: <strong>${match.label}</strong></p>`;
    }
  }, 600);
}

/* ===== Cleanup ===== */
window.addEventListener("beforeunload", () => {
  try {
    if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  } catch (e) {}
  clearDetectionLoops();
});
