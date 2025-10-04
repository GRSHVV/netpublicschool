let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let lastDetection = null;

/* ===== Load Models ===== */
async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("models")
  ]);
  modelsLoaded = true;
  console.log("✅ Models loaded");
}

/* ===== Start Camera ===== */
async function startCamera(deviceId = null) {
  try {
    if (currentStream) currentStream.getTracks().forEach(track => track.stop());

    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;

    const video = document.getElementById("video");
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play();
      const canvas = document.getElementById("overlay");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    };
  } catch (err) {
    console.error("Camera error:", err);
    alert("Could not access camera. Please allow permissions.");
  }
}

/* ===== Page Load ===== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
});

/* ===== Mode Switch ===== */
function switchMode(mode) {
  currentMode = mode;
  const c = document.querySelector(".content-area");
  clearInterval(adminDetectInterval);

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register User</h3>
      <div class="form-group"><label>Name</label><input id="username"></div>
      <div class="form-group"><label>Role</label>
        <select id="role">
          <option>Father</option><option>Mother</option>
          <option>Guardian</option><option>Other</option>
        </select>
      </div>
      <p style="font-size: 0.85em; color: #777;">📷 Show your face or a photo in front of camera.</p>
      <h4>Registered Users</h4><ul id="userList"></ul>
      <button id="registerBtn" disabled onclick="registerFace()">Register</button>
    `;
    loadUsers();
    startLiveDetection();
  }

  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition (Live Only)</h3>
      <div id="childSelection"></div>
    `;
    startRecognition();
  }
}

/* ===== Adaptive Face Detection ===== */
async function startLiveDetection() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const btn = document.getElementById("registerBtn");

  adminDetectInterval = setInterval(async () => {
    if (currentMode !== "admin") {
      clearInterval(adminDetectInterval);
      return;
    }
    if (!modelsLoaded || video.readyState !== 4) return;

    let threshold = 0.4;
    let inputSize = 416;

    if (lastDetection) {
      const boxRatio = lastDetection.detection.box.width / video.videoWidth;
      if (boxRatio < 0.2) {
        threshold = 0.3;
        inputSize = 512;
      } else if (boxRatio > 0.5) {
        threshold = 0.5;
        inputSize = 320;
      }
    }

    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: threshold }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detection) {
      const box = detection.detection.box;
      const expand = 0.2;
      const newX = Math.max(0, box.x - box.width * expand / 2);
      const newY = Math.max(0, box.y - box.height * expand / 2);
      const newW = Math.min(canvas.width - newX, box.width * (1 + expand));
      const newH = Math.min(canvas.height - newY, box.height * (1 + expand));

      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 3;
      ctx.strokeRect(newX, newY, newW, newH);

      lastDetection = detection;
      const name = document.getElementById("username")?.value.trim();
      btn.disabled = !name;
    } else {
      btn.disabled = true;
      lastDetection = null;
    }
  }, 400);
}
