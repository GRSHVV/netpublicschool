let currentMode = null;
let modelsLoaded = false;
let lastRecognizedId = null;
let adminDetectInterval = null;

/* Camera + Models */
async function startCamera() {
  try {
    const video = document.getElementById("video");
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
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
    faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("/models")
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

/* Mode Switching */
function switchMode(mode) {
  currentMode = mode;
  const c = document.getElementById("modeContent");

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register User</h3>
      <div class="scroll-area">
        <div class="form-group"><label>Name</label><input id="username"></div>
        <div class="form-group"><label>Role</label>
          <select id="role"><option>Father</option><option>Mother</option><option>Guardian</option><option>Other</option></select>
        </div>
        <h4>Registered Users</h4><ul id="userList"></ul>
      </div>
      <div class="actions">
        <button id="captureBtn" class="capture disabled" onclick="captureUser()" disabled>No Face Detected</button>
      </div>
    `;
    loadUsers();
    startAdminDetection();
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
          <select id="relationLabel"><option>Father</option><option>Mother</option><option>Guardian</option><option>Other</option></select>
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
      <div class="scroll-area" id="childSelection"></div>
      <div class="actions">
        <button onclick="submitPickup()">Submit Pickup</button>
      </div>
    `;
    startRecognition();
  }
}

/* Admin Detection */
async function startAdminDetection() {
  clearInterval(adminDetectInterval);
  const video = document.getElementById("video");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const btn = document.querySelector("#captureBtn");

  adminDetectInterval = setInterval(async () => {
    if (currentMode !== "admin") {
      clearInterval(adminDetectInterval);
      return;
    }
    if (!modelsLoaded || video.readyState !== 4) return;

    const detection = await faceapi.detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })
    );

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (detection) {
      const { x, y, width, height } = detection.box;
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      btn.disabled = false;
      btn.textContent = "Capture Face";
      btn.classList.remove("disabled");
      btn.classList.add("active");
    } else {
      btn.disabled = true;
      btn.textContent = "No Face Detected";
      btn.classList.remove("active");
      btn.classList.add("disabled");
    }
  }, 300);
}

/* Admin Capture */
async function captureUser() {
  if (!modelsLoaded) return alert("Models not loaded");
  const name = document.getElementById("username").value.trim();
  const role = document.getElementById("role").value.trim();
  if (!name) return alert("Enter name");

  const video = document.getElementById("video");
  const det = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
  if (!det) return alert("No face detected");

  const user = { id: Date.now().toString(), name, role, descriptor: Array.from(det.descriptor) };
  await window.dbAPI.addUser(user);

  const btn = document.getElementById("captureBtn");
  btn.disabled = true;
  btn.textContent = "No Face Detected";
  btn.classList.remove("active");
  btn.classList.add("disabled");

  alert(`✅ Registered ${name}`);
  loadUsers();
}

/* Children */
async function addChild() {
  const name = document.getElementById("childName").value.trim();
  const c = document.getElementById("childClass").value.trim();
  const s = document.getElementById("childSection").value.trim();

  if (!name) return alert("Enter child name");

  await window.dbAPI.addChild({
    id: Date.now().toString(),
    name,
    class: c,
    section: s
  });

  document.getElementById("childName").value = "";
  document.getElementById("childClass").value = "";
  document.getElementById("childSection").value = "";

  loadChildren();
}

async function loadChildren() {
  const kids = await window.dbAPI.getAllChildren();
  const list = document.getElementById("childrenList");
  list.innerHTML = "";

  kids.forEach(k => {
    const li = document.createElement("li");
    li.textContent = `${k.name} (${k.class}${k.section})`;

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger small";
    del.onclick = async () => {
      await window.dbAPI.deleteChild(k.id);
      loadChildren();
    };

    li.appendChild(del);
    list.appendChild(li);
  });
}
