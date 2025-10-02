let currentMode = null;
let modelsLoaded = false;
let lastRecognizedId = null;
let adminAutoInterval = null;
let currentStream = null;

/* Camera + Models */
async function startCamera(deviceId = null) {
  try {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }

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
    alert("Camera permission denied");
  }
}

async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("models")
  ]);
  modelsLoaded = true;
  console.log("✅ Models loaded");
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  loadAuditTicker();
  setInterval(loadAuditTicker, 5000);
});

/* ===== Camera Selection ===== */
async function populateCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(d => d.kind === "videoinput");
  const select = document.getElementById("cameraSelect");
  if (!select) return;
  select.innerHTML = "";
  videoDevices.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Camera ${index + 1}`;
    select.appendChild(option);
  });
}

async function changeCamera() {
  const select = document.getElementById("cameraSelect");
  if (!select) return;
  const deviceId = select.value;
  await startCamera(deviceId);
}

/* ===== Mode Switching ===== */
function switchMode(mode) {
  currentMode = mode;
  const c = document.getElementById("modeContent");

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
        <h4>Registered Users</h4><ul id="userList"></ul>
      </div>
    `;
    loadUsers();
    startAdminAutoCapture();
  }

  if (mode === "children") {
    c.innerHTML = `
      <h3>Manage Children</h3>
      <div class="scroll-area">
        <div class="form-group"><label>Child Name</label><input id="childName"></div>
        <div class="form-group"><label>Class</label><input id="childClass"></div>
        <div class="form-group"><label>Section</label><input id="childSection"></div>
        <h4>Children</h4><ul id="childrenList"></ul>
      </div>
      <div class="actions">
        <button onclick="addChild()">Add</button>
      </div>
    `;
    loadChildren();
  }

  if (mode === "relations") {
    c.innerHTML = `
      <h3>Manage Relations</h3>
      <div class="scroll-area">
        <div class="form-group"><label>User</label><select id="userSelect"></select></div>
        <div class="form-group"><label>Child</label><select id="childSelect"></select></div>
        <div class="form-group"><label>Relation</label>
          <select id="relationLabel">
            <option>Father</option><option>Mother</option>
            <option>Guardian</option><option>Other</option>
          </select>
        </div>
        <h4>Relations</h4><ul id="relationList"></ul>
      </div>
      <div class="actions">
        <button onclick="linkRelation()">Link</button>
      </div>
    `;
    loadRelations();
  }

  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div class="scroll-area" id="childSelection">
        <div class="form-group">
          <label for="cameraSelect">Camera</label>
          <select id="cameraSelect" onchange="changeCamera()"></select>
        </div>
      </div>
      <div class="actions">
        <button onclick="submitPickup()">Submit Pickup</button>
      </div>
    `;
    populateCameras();
    startRecognition();
  }
}

/* ===== Admin Auto Capture ===== */
async function startAdminAutoCapture() {
  clearInterval(adminAutoInterval);
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");

  adminAutoInterval = setInterval(async () => {
    if (currentMode !== "admin") {
      clearInterval(adminAutoInterval);
      return;
    }
    if (!modelsLoaded || video.readyState !== 4) return;

    const name = document.getElementById("username").value.trim();
    const role = document.getElementById("role").value.trim();

    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detection) {
      const { x, y, width, height } = detection.detection.box;
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      if (name && role) {
        // Take snapshot
        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = video.videoWidth;
        snapCanvas.height = video.videoHeight;
        const snapCtx = snapCanvas.getContext("2d");
        snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
        const photo = snapCanvas.toDataURL("image/png");

        // Save user
        const user = {
          id: Date.now().toString(),
          name,
          role,
          descriptor: Array.from(detection.descriptor),
          photo
        };
        await window.dbAPI.addUser(user);

        alert(`✅ Registered ${name}`);
        document.getElementById("username").value = "";
        loadUsers();

        clearInterval(adminAutoInterval); // stop after registration
      }
    }
  }, 500);
}

/* ===== Users List ===== */
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
