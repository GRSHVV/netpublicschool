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
  const c = document.getElementById("modeContent");
  clearInterval(adminDetectInterval);

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register User</h3>
      <div class="scroll-area">
        <div class="form-group"><label>Name</label><input id="username"></div>
        <div class="form-group"><label>Role</label>
          <select id="role">
            <option>Father</option><option>Mother</option>
            <option>Guardian</option><option>Other</option>
          </select>
        </div>
        <p style="font-size: 0.85em; color: #777;">📷 Show your face or photo clearly to the camera.</p>
        <h4>Registered Users</h4><ul id="userList"></ul>
      </div>
      <div class="actions">
        <button id="registerBtn" disabled onclick="registerFace()">Register</button>
      </div>
    `;
    loadUsers();
    startLiveDetection();
  }

  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition (Live Only)</h3>
      <div class="scroll-area" id="childSelection"></div>
    `;
    startRecognition();
  }
}

/* ===== Adaptive Threshold + Expanded Box Detection ===== */
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
      const boxWidthRatio = lastDetection.detection.box.width / video.videoWidth;
      if (boxWidthRatio < 0.2) {
        threshold = 0.3;
        inputSize = 512;
      } else if (boxWidthRatio > 0.5) {
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
      const name = document.getElementById("username").value.trim();
      btn.disabled = !name;
    } else {
      btn.disabled = true;
      lastDetection = null;
    }
  }, 400);
}

/* ===== Register User ===== */
async function registerFace() {
  const name = document.getElementById("username").value.trim();
  const role = document.getElementById("role").value.trim();
  if (!name) return alert("Enter name first");
  if (!lastDetection) return alert("No face detected");

  const video = document.getElementById("video");
  const snapCanvas = document.createElement("canvas");
  snapCanvas.width = video.videoWidth;
  snapCanvas.height = video.videoHeight;
  const ctx = snapCanvas.getContext("2d");
  ctx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
  const photo = snapCanvas.toDataURL("image/png");

  const user = {
    id: Date.now().toString(),
    name,
    role,
    descriptor: Array.from(lastDetection.descriptor),
    photo
  };

  await window.dbAPI.addUser(user);
  alert(`✅ Registered ${name}`);
  document.getElementById("username").value = "";
  loadUsers();
}

/* ===== Load Users ===== */
async function loadUsers() {
  const users = await window.dbAPI.getAllUsers();
  const list = document.getElementById("userList");
  if (!list) return;
  list.innerHTML = "";
  users.forEach(u => {
    const li = document.createElement("li");
    if (u.photo) {
      const img = document.createElement("img");
      img.src = u.photo;
      img.width = 40;
      img.height = 40;
      img.style.borderRadius = "50%";
      img.style.marginRight = "8px";
      li.appendChild(img);
    }
    const span = document.createElement("span");
    span.textContent = `${u.name} (${u.role})`;
    li.appendChild(span);
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger small";
    del.onclick = async () => {
      await window.dbAPI.deleteUser(u.id);
      loadUsers();
    };
    li.appendChild(del);
    list.appendChild(li);
  });
}

/* ===== Recognition Mode ===== */
async function startRecognition() {
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const users = await window.dbAPI.getAllUsers();

  if (users.length === 0) return;

  const labeled = users.map(u => new faceapi.LabeledFaceDescriptors(
    u.name,
    [new Float32Array(u.descriptor)]
  ));
  const matcher = new faceapi.FaceMatcher(labeled, 0.6);

  setInterval(async () => {
    if (currentMode !== "recognition") return;
    if (!modelsLoaded || video.readyState !== 4) return;

    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detection) {
      const { x, y, width, height } = detection.detection.box;
      ctx.strokeStyle = "green";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      const bestMatch = matcher.findBestMatch(detection.descriptor);
      document.getElementById("childSelection").innerHTML =
        `<p>${bestMatch.label !== "unknown" ? `Recognized: <strong>${bestMatch.label}</strong>` : "❌ Unrecognized"}</p>`;
    }
  }, 600);
}
