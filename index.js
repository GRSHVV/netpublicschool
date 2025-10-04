// index.js — Smart Pickup System
// Full version with 3-second persistent bounding box for registration and recognition

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
  v.onloadedmetadata = () => v.play();
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

  /* ---------------- Parent Registration ---------------- */
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

  /* ---------------- Child Registration ---------------- */
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

  /* ---------------- Class & Section Management ---------------- */
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

  /* ---------------- Parent–Child Linking ---------------- */
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

  /* ---------------- Recognition ---------------- */
  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div id="recognitionResult" class="result-box"></div>
    `;
    startRecognition();
  }
}

/* =====================================================
   FACE DETECTION (3-second persistence)
===================================================== */
function detectParentFace() {
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const ctx = o.getContext("2d");
  const btn = document.getElementById("registerBtn");

  adminDetectInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const now = Date.now();

    // Keep existing bounding box for 3 seconds
    if (lastDetection && now - lastDrawTime < 3000) return;

    const detection = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    const displaySize = { width: o.width, height: o.height };
    faceapi.matchDimensions(o, displaySize);
    ctx.clearRect(0, 0, o.width, o.height);

    if (detection) {
      const resized = faceapi.resizeResults(detection, displaySize);
      faceapi.draw.drawDetections(o, resized);
      lastDetection = detection;
      lastDrawTime = now;
      btn.disabled = !document.getElementById("username").value.trim();
    } else {
      if (now - lastDrawTime >= 3000) {
        ctx.clearRect(0, 0, o.width, o.height);
        lastDetection = null;
        btn.disabled = true;
      }
    }
  }, 300);
}

/* =====================================================
   REGISTER PARENT
===================================================== */
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

/* =====================================================
   REGISTER CHILD
===================================================== */
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

/* =====================================================
   CLASS & SECTION MANAGEMENT
===================================================== */
async function addClass() {
  const name = document.getElementById("className").value.trim();
  if (!name) return alert("Enter class name");
  await window.dbAPI.addClass(name);
  document.getElementById("className").value = "";
  loadClassList();
}

async function addSection() {
  const name = document.getElementById("sectionName").value.trim();
  if (!name) return alert("Enter section name");
  await window.dbAPI.addSection(name);
  document.getElementById("sectionName").value = "";
  loadSectionList();
}

async function loadClassList() {
  const list = document.getElementById("classList");
  const classes = await window.dbAPI.getAllClasses();
  list.innerHTML = classes
    .map(
      (x) => `<li class='list-item'>${x.name}
        <button class='danger' onclick="deleteClass('${x.id}')">Delete</button></li>`
    )
    .join("");
}

async function loadSectionList() {
  const list = document.getElementById("sectionList");
  const sections = await window.dbAPI.getAllSections();
  list.innerHTML = sections
    .map(
      (x) => `<li class='list-item'>${x.name}
        <button class='danger' onclick="deleteSection('${x.id}')">Delete</button></li>`
    )
    .join("");
}

async function deleteClass(id) {
  await window.dbAPI.deleteClass(id);
  loadClassList();
}
async function deleteSection(id) {
  await window.dbAPI.deleteSection(id);
  loadSectionList();
}

async function loadClassSectionOptions(classId, sectionId) {
  const classSelect = document.getElementById(classId);
  const sectionSelect = document.getElementById(sectionId);
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  classSelect.innerHTML = classes.map((c) => `<option>${c.name}</option>`).join("");
  sectionSelect.innerHTML = sections.map((s) => `<option>${s.name}</option>`).join("");
}

/* =====================================================
   PARENT–CHILD LINKING
===================================================== */
async function setupLinkSearchHandlers() {
  const parentInput = document.getElementById("parentSearch");
  const parentSelect = document.getElementById("parentSelect");
  const childInput = document.getElementById("childSearch");
  const classSelect = document.getElementById("linkClass");
  const sectionSelect = document.getElementById("linkSection");
  const childSelect = document.getElementById("childrenSelect");

  parentInput.oninput = async () => {
    const term = parentInput.value.trim().toLowerCase();
    const parents = await window.dbAPI.getAllUsers();
    parentSelect.innerHTML = "";
    if (term.length >= 3) {
      const filtered = parents.filter((p) => p.name.toLowerCase().startsWith(term));
      filtered.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.role})`;
        parentSelect.appendChild(opt);
      });
    }
  };

  const updateChildList = async () => {
    const term = childInput.value.trim().toLowerCase();
    const cls = classSelect.value.trim().toLowerCase();
    const sec = sectionSelect.value.trim().toLowerCase();
    const allChildren = await window.dbAPI.getAllChildren();
    childSelect.innerHTML = "";
    const filtered = allChildren.filter((ch) => {
      const matchName = term.length >= 3 ? ch.name.toLowerCase().startsWith(term) : true;
      const matchClass = cls ? ch.class.toLowerCase() === cls : true;
      const matchSec = sec ? ch.section.toLowerCase() === sec : true;
      return matchName && matchClass && matchSec;
    });
    filtered.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.class}-${c.section})`;
      childSelect.appendChild(opt);
    });
  };

  [childInput, classSelect, sectionSelect].forEach((el) => (el.oninput = updateChildList));
}

async function linkParentChild() {
  const pid = document.getElementById("parentSelect").value;
  const cs = Array.from(document.getElementById("childrenSelect").selectedOptions).map(
    (o) => o.value
  );
  if (!pid || !cs.length) return alert("Select parent and at least one child.");
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

/* =====================================================
   RECOGNITION (with 3-second persistence)
===================================================== */
async function startRecognition() {
  const users = await window.dbAPI.getAllUsers();
  const links = await window.dbAPI.getAllLinks();
  const children = await window.dbAPI.getAllChildren();

  if (!users.length) {
    setStatus("⚠️ No registered parents found.");
    return;
  }

  // Create labeled face descriptors
  const labeled = users.map(
    (u) => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)])
  );
  const matcher = new faceapi.FaceMatcher(labeled, 0.7); // relaxed threshold

  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const ctx = o.getContext("2d");
  const resultBox = document.getElementById("recognitionResult");

  let lastResultTime = 0;
  let lastResult = null;

  recognitionInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const now = Date.now();

    // Dynamically sync overlay canvas size to video
    const videoRect = v.getBoundingClientRect();
    o.width = videoRect.width;
    o.height = videoRect.height;

    if (lastResult && now - lastResultTime < 3000) return; // 3s persistence

    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    const displaySize = { width: o.width, height: o.height };
    faceapi.matchDimensions(o, displaySize);
    ctx.clearRect(0, 0, o.width, o.height);
    resultBox.innerHTML = "";

    if (det) {
      const resized = faceapi.resizeResults(det, displaySize);
      const best = matcher.findBestMatch(det.descriptor);
      const box = resized.detection.box;

      // Draw bounding box
      if (best.label === "unknown") {
        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = "red";
        ctx.font = "16px Arial";
        ctx.fillText("Unrecognized", box.x, box.y - 10);

        resultBox.innerHTML =
          "<p style='color:red; font-weight:600;'>❌ Unrecognized face</p>";
        lastResult = "unknown";
      } else {
        ctx.strokeStyle = "green";
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = "green";
        ctx.font = "16px Arial";
        ctx.fillText(best.label, box.x, box.y - 10);

        // Retrieve linked children
        const parent = users.find((u) => u.name === best.label);
        const link = links.find((l) => l.parentId === parent?.id);

        if (link && link.childrenIds.length > 0) {
          // ✅ Show all linked children correctly
          const kids = link.childrenIds
            .map((cid) => {
              const c = children.find((ch) => ch.id === cid);
              return c ? `<li>${c.name} (${c.class}-${c.section})</li>` : "";
            })
            .join("");

          resultBox.innerHTML = `
            <p style='color:green; font-weight:600;'>✅ Recognized: ${best.label}</p>
            <p><strong>Linked Children:</strong></p>
            <ul style="margin-left:10px; list-style-type:circle;">${kids}</ul>
          `;
        } else {
          resultBox.innerHTML = `
            <p style='color:orange; font-weight:600;'>✅ Recognized: ${best.label}</p>
            <p>No linked children found</p>
          `;
        }
        lastResult = best.label;
      }

      lastResultTime = now;
    }
  }, 500);
}


/* =====================================================
   CLEANUP
===================================================== */
function clearIntervals() {
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
}

window.addEventListener("beforeunload", () => {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  clearIntervals();
});
