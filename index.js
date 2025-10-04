// index.js — Smart Pickup System (Complete Final File)
// Features:
// - Multi-camera handling & switching
// - Parent registration (face capture)
// - Child registration (class & section dropdowns)
// - Class & Section management
// - Many-to-many linking between parents and children
// - Recognition with 3-second bounding-box persistence and multi-child display
// - Safe interval management and cleanup

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let lastDetection = null;
let lastDrawTime = 0;
let videoDevices = [];
let currentDeviceId = null;

/* =====================================================
   STATUS HANDLER
===================================================== */
function setStatus(msg) {
  const el = document.getElementById("statusMsg");
  if (el) el.textContent = msg;
  console.log("[STATUS]", msg);
}

/* =====================================================
   CLEAR INTERVALS
===================================================== */
function clearIntervals() {
  if (adminDetectInterval) {
    clearInterval(adminDetectInterval);
    adminDetectInterval = null;
  }
  if (recognitionInterval) {
    clearInterval(recognitionInterval);
    recognitionInterval = null;
  }
}

/* =====================================================
   LOAD MODELS
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
   CAMERA HANDLING (multi-device switching)
===================================================== */
async function ensureCameraPermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert("Camera permission required.");
    throw err;
  }
}

async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");

  const select = document.getElementById("cameraSelect");
  if (!select) return;
  select.innerHTML = "";
  videoDevices.forEach((device, i) => {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.textContent = device.label || `Camera ${i + 1}`;
    select.appendChild(opt);
  });

  // Default selection: prefer back/rear camera on mobile
  if (!currentDeviceId && videoDevices.length > 0) {
    const backCam = videoDevices.find((d) =>
      /back|rear|environment/i.test(d.label)
    );
    currentDeviceId = backCam ? backCam.deviceId : videoDevices[0].deviceId;
  }

  select.value = currentDeviceId || (videoDevices[0] && videoDevices[0].deviceId) || "";

  // Handle dropdown change
  select.onchange = async (e) => {
    const newId = e.target.value;
    if (newId && newId !== currentDeviceId) {
      await switchCamera(newId);
    }
  };
}

async function startCamera() {
  await ensureCameraPermission();
  await getVideoDevices();
  if (!currentDeviceId && videoDevices.length > 0) currentDeviceId = videoDevices[0].deviceId;
  await switchCamera(currentDeviceId);
}

async function switchCamera(deviceId) {
  try {
    // Stop existing stream if any
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }

    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
      audio: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = document.getElementById("video");
    v.srcObject = stream;
    currentStream = stream;
    currentDeviceId = deviceId;

    v.onloadedmetadata = () => {
      v.play();
      resizeOverlay();
      setStatus(`🎥 Active: ${getCameraLabel(deviceId)}`);
    };
  } catch (err) {
    console.error("Camera switch failed:", err);
    alert("Unable to activate selected camera. Please check permissions or try another device.");
  }
}

function getCameraLabel(deviceId) {
  const d = videoDevices.find((x) => x.deviceId === deviceId);
  return d ? d.label || "Camera" : "Camera";
}

function resizeOverlay() {
  const v = document.getElementById("video");
  const c = document.getElementById("overlay");
  if (!v || !c) return;
  // Use bounding rect to match CSS-rendered size
  const rect = v.getBoundingClientRect();
  c.width = rect.width;
  c.height = rect.height;
  // Also set canvas style to overlay exactly
  c.style.width = `${rect.width}px`;
  c.style.height = `${rect.height}px`;
}

/* =====================================================
   INITIALIZATION
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await window.dbAPI.openDB();
  } catch (err) {
    console.error("DB open error:", err);
  }
  try {
    await loadModels();
  } catch (err) {
    console.error("Model load error:", err);
    setStatus("Model load failed. Check models folder path.");
  }

  try {
    await startCamera();
  } catch (err) {
    console.error("Camera start failed:", err);
    setStatus("Camera not started. Grant permission or check device.");
  }

  resizeOverlay();
  switchMode("admin");

  // Bind main menu buttons after DOM loaded
  const btnAdmin = document.getElementById("btnAdmin");
  const btnChild = document.getElementById("btnChild");
  const btnClass = document.getElementById("btnClass");
  const btnLink = document.getElementById("btnLink");
  const btnRecognition = document.getElementById("btnRecognition");
  if (btnAdmin) btnAdmin.addEventListener("click", () => switchMode("admin"));
  if (btnChild) btnChild.addEventListener("click", () => switchMode("child"));
  if (btnClass) btnClass.addEventListener("click", () => switchMode("class"));
  if (btnLink) btnLink.addEventListener("click", () => switchMode("link"));
  if (btnRecognition) btnRecognition.addEventListener("click", () => switchMode("recognition"));

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
  if (!c) return;

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
  } else if (mode === "child") {
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
  } else if (mode === "class") {
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
  } else if (mode === "link") {
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
  } else if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div id="recognitionResult" class="result-box"></div>
    `;
    startRecognition();
  }
}

/* =====================================================
   FACE DETECTION FOR REGISTRATION (3-second persistence)
===================================================== */
function detectParentFace() {
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  if (!v || !o) return;
  const ctx = o.getContext("2d");
  const btn = document.getElementById("registerBtn");

  adminDetectInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const now = Date.now();
    // If a detection was drawn recently, keep it visible for 3 seconds
    if (lastDetection && now - lastDrawTime < 3000) return;

    // Ensure overlay matches video size
    resizeOverlay();

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
      if (btn) btn.disabled = !document.getElementById("username").value.trim();
    } else {
      if (now - lastDrawTime >= 3000) {
        ctx.clearRect(0, 0, o.width, o.height);
        lastDetection = null;
        if (btn) btn.disabled = true;
      }
    }
  }, 300);
}

/* =====================================================
   REGISTER / PARENT FUNCTIONS
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
  const listEl = document.getElementById("userList");
  if (!listEl) return;
  listEl.innerHTML = p.map((x) => `<li class='list-item'>${x.name} (${x.role})</li>`).join("");
}

/* =====================================================
   CHILD FUNCTIONS
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
  const listEl = document.getElementById("childList");
  if (!listEl) return;
  listEl.innerHTML = c.map((x) => `<li class='list-item'>${x.name} (${x.class}-${x.section})</li>`).join("");
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
  if (!list) return;
  const classes = await window.dbAPI.getAllClasses();
  list.innerHTML = classes.map(
    (x) => `<li class='list-item'>${x.name}
        <button class='danger' onclick="deleteClass('${x.id}')">Delete</button></li>`
  ).join("");
}

async function loadSectionList() {
  const list = document.getElementById("sectionList");
  if (!list) return;
  const sections = await window.dbAPI.getAllSections();
  list.innerHTML = sections.map(
    (x) => `<li class='list-item'>${x.name}
        <button class='danger' onclick="deleteSection('${x.id}')">Delete</button></li>`
  ).join("");
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
  if (!classSelect || !sectionSelect) return;
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

  if (!parentInput || !parentSelect || !childInput || !childSelect) return;

  parentInput.oninput = async () => {
    const term = parentInput.value.trim().toLowerCase();
    const parents = await window.dbAPI.getAllUsers();
    parentSelect.innerHTML = "";
    if (term.length >= 3) {
      parents.filter((p) => p.name.toLowerCase().startsWith(term)).forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.role})`;
        parentSelect.appendChild(opt);
      });
    }
  };

  const updateChildList = async () => {
    const term = childInput.value.trim().toLowerCase();
    const cls = (classSelect && classSelect.value || "").trim().toLowerCase();
    const sec = (sectionSelect && sectionSelect.value || "").trim().toLowerCase();
    const allChildren = await window.dbAPI.getAllChildren();
    childSelect.innerHTML = "";
    allChildren.filter((ch) => {
      const matchName = term.length >= 3 ? ch.name.toLowerCase().startsWith(term) : true;
      const matchClass = cls ? ch.class.toLowerCase() === cls : true;
      const matchSec = sec ? ch.section.toLowerCase() === sec : true;
      return matchName && matchClass && matchSec;
    }).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.class}-${c.section})`;
      childSelect.appendChild(opt);
    });
  };

  [childInput, classSelect, sectionSelect].forEach((el) => {
    if (el) el.oninput = updateChildList;
  });
}

async function linkParentChild() {
  const pidEl = document.getElementById("parentSelect");
  const childrenSelect = document.getElementById("childrenSelect");
  if (!pidEl || !childrenSelect) return alert("Link UI not ready.");

  const pid = pidEl.value;
  const cs = Array.from(childrenSelect.selectedOptions).map((o) => o.value);
  if (!pid || !cs.length) return alert("Select parent and at least one child.");
  await window.dbAPI.linkParentChildren(pid, cs);
  alert("✅ Linked successfully!");
  loadLinks();
}

async function loadLinks() {
  const list = document.getElementById("linkList");
  if (!list) return;
  const links = await window.dbAPI.getAllLinks();
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  list.innerHTML = "";
  links.forEach((l) => {
    const parent = parents.find((p) => p.id === l.parentId);
    const linkedChildren = l.childrenIds
      .map((cid) => {
        const ch = children.find((c) => c.id === cid);
        return ch ? `${ch.name} (${ch.class}-${ch.section})` : "";
      })
      .filter(Boolean)
      .join(", ");
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `<strong>${parent ? parent.name : "(unknown parent)"}</strong> → ${linkedChildren}`;
    list.appendChild(li);
  });
}

/* =====================================================
   RECOGNITION (3-sec persistence + multi-child list)
===================================================== */
async function startRecognition() {
  const users = await window.dbAPI.getAllUsers();
  const links = await window.dbAPI.getAllLinks();
  const children = await window.dbAPI.getAllChildren();
  if (!users.length) {
    setStatus("⚠️ No registered parents found.");
    return;
  }

  const labeled = users.map(
    (u) => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)])
  );
  const matcher = new faceapi.FaceMatcher(labeled, 0.7);

  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  if (!v || !o) return;
  const ctx = o.getContext("2d");
  const resultBox = document.getElementById("recognitionResult");

  let lastResultTime = 0;
  let lastResult = null;

  recognitionInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const now = Date.now();

    // Keep previous result for 3 seconds
    if (lastResult && now - lastResultTime < 3000) return;

    // Sync overlay size with video
    resizeOverlay();

    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    const displaySize = { width: o.width, height: o.height };
    faceapi.matchDimensions(o, displaySize);
    ctx.clearRect(0, 0, o.width, o.height);
    if (resultBox) resultBox.innerHTML = "";

    if (det) {
      const resized = faceapi.resizeResults(det, displaySize);
      const best = matcher.findBestMatch(det.descriptor);
      const box = resized.detection.box;

      if (best.label === "unknown") {
        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = "red";
        ctx.font = "16px Arial";
        ctx.fillText("Unrecognized", box.x, box.y - 10);
        if (resultBox) resultBox.innerHTML = "<p style='color:red; font-weight:600;'>❌ Unrecognized face</p>";
        lastResult = "unknown";
      } else {
        ctx.strokeStyle = "green";
        ctx.lineWidth = 3;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillStyle = "green";
        ctx.font = "16px Arial";
        ctx.fillText(best.label, box.x, box.y - 10);

        const parent = users.find((u) => u.name === best.label);
        const link = links.find((l) => l.parentId === parent?.id);

        if (link && link.childrenIds && link.childrenIds.length > 0) {
          const kidsHtml = link.childrenIds
            .map((cid) => {
              const ch = children.find((c) => c.id === cid);
              return ch ? `<li>${ch.name} (${ch.class}-${ch.section})</li>` : "";
            })
            .join("");
          if (resultBox) resultBox.innerHTML = `
            <p style='color:green; font-weight:600;'>✅ Recognized: ${best.label}</p>
            <p><strong>Linked Children:</strong></p>
            <ul style="margin-left:10px; list-style: disc;">${kidsHtml}</ul>`;
        } else {
          if (resultBox) resultBox.innerHTML = `
            <p style='color:green; font-weight:600;'>✅ Recognized: ${best.label}</p>
            <p>No linked children found</p>`;
        }
        lastResult = best.label;
      }

      lastResultTime = now;
    } else {
      // No face detected — clear status if past persistence window
      setStatus("No face detected...");
    }
  }, 400);
}

/* =====================================================
   CLEANUP
===================================================== */
window.addEventListener("beforeunload", () => {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  clearIntervals();
});
