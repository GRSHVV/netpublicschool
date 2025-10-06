"use strict";

/* ============================================================
   Smart Pickup App (Working Full Version)
   ============================================================ */

let video, overlay, ctx;
let modelsLoaded = false;
let detectionLoop = null;
let currentMode = null;
let currentCameraId = null;
let allVideoDevices = [];
let recognitionMatcher = null;
let lastDetection = null;

/* ============================================================
   Helper Functions
   ============================================================ */
const $ = (id) => document.getElementById(id);
const log = (...a) => console.log("[LOG]", ...a);
const setStatus = (msg) => { if ($("statusMsg")) $("statusMsg").textContent = msg; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   Load Face API Models
   ============================================================ */
async function loadFaceModels() {
  try {
    setStatus("Loading AI models...");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    ]);
    modelsLoaded = true;
    log("✅ Face models loaded");
    setStatus("Models ready");
  } catch (e) {
    console.error("Model load error:", e);
    alert("❌ Failed to load models — check ./models folder path.");
  }
}

/* ============================================================
   Camera Handling
   ============================================================ */
async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    allVideoDevices = devices.filter((d) => d.kind === "videoinput");

    const select = $("cameraSelect");
    if (!select) return;
    select.innerHTML = "";

    allVideoDevices.forEach((dev, i) => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Camera ${i + 1}`;
      select.appendChild(opt);
    });

    select.onchange = async () => {
      await startCamera(select.value);
    };
  } catch (e) {
    console.error("Camera list error:", e);
  }
}

async function startCamera(deviceId = null) {
  try {
    if (video?.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
    }

    const constraints = deviceId
      ? { video: { deviceId: { ideal: deviceId } } }
      : { video: { facingMode: { ideal: "environment" } } };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    if (modelsLoaded) startDetectionLoop();
    setStatus("📷 Camera Active");
  } catch (e) {
    console.error("Camera error:", e);
    alert("❌ Camera not available or permission denied.");
  }
}

/* ============================================================
   Face Detection Loop
   ============================================================ */
async function startDetectionLoop() {
  if (!modelsLoaded) return;
  clearInterval(detectionLoop);
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224 });

  detectionLoop = setInterval(async () => {
    if (!video || video.readyState < 2) return;
    const detection = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (detection) {
      lastDetection = detection;
      const box = detection.detection.box;
      ctx.strokeStyle = "lime";
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      if (currentMode === "registerParent") $("registerBtn").disabled = false;
    } else {
      $("registerBtn")?.setAttribute("disabled", true);
    }
  }, 500);
}

/* ============================================================
   Load Pages / Modules
   ============================================================ */
async function loadRegisterParent() {
  currentMode = "registerParent";
  clearInterval(detectionLoop);
  $("modeContent").innerHTML = `
    <h3>Register Parent</h3>
    <label>Parent Name:</label>
    <input id="parentName" placeholder="e.g. John Doe" />
    <label>Role:</label>
    <select id="parentRole">
      <option value="father">Father</option>
      <option value="mother">Mother</option>
      <option value="guardian">Guardian</option>
    </select>
    <button id="registerBtn" disabled>Register</button>
  `;
  await startCamera();
  $("registerBtn").onclick = async () => {
    const name = $("parentName").value.trim().toLowerCase();
    const role = $("parentRole").value.toLowerCase();
    if (!name) return alert("Enter parent name.");
    if (!lastDetection) return alert("No face detected.");
    const desc = Array.from(lastDetection.descriptor);
    await window.dbAPI.addUser({ id: Date.now().toString(), name, role, descriptor: desc });
    alert("✅ Parent Registered!");
    await buildMatcherFromDB();
    await updateStats();
  };
}

async function loadClassManager() {
  currentMode = "classManager";
  $("modeContent").innerHTML = `
    <h3>Manage Classes & Sections</h3>
    <label>Class:</label>
    <input id="classInput" placeholder="e.g. 8th" />
    <button id="addClassBtn">Add Class</button>
    <ul id="classList"></ul>
    <label>Section:</label>
    <input id="sectionInput" placeholder="e.g. A" />
    <button id="addSectionBtn">Add Section</button>
    <ul id="sectionList"></ul>
  `;
  refreshClassSectionLists();

  $("addClassBtn").onclick = async () => {
    const c = $("classInput").value.trim().toLowerCase();
    if (!c) return;
    await window.dbAPI.addClassEntry({ id: Date.now().toString(), className: c });
    $("classInput").value = "";
    refreshClassSectionLists();
  };
  $("addSectionBtn").onclick = async () => {
    const s = $("sectionInput").value.trim().toLowerCase();
    if (!s) return;
    await window.dbAPI.addSectionEntry({ id: Date.now().toString(), sectionName: s });
    $("sectionInput").value = "";
    refreshClassSectionLists();
  };
}

async function refreshClassSectionLists() {
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  $("classList").innerHTML = classes.map((c) => `<li>${c.className}</li>`).join("");
  $("sectionList").innerHTML = sections.map((s) => `<li>${s.sectionName}</li>`).join("");
}

async function loadRegisterChild() {
  currentMode = "registerChild";
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  $("modeContent").innerHTML = `
    <h3>Register Child</h3>
    <label>Child Name:</label>
    <input id="childName" />
    <label>Class:</label>
    <select id="childClass">
      ${classes.map((c) => `<option>${c.className}</option>`).join("")}
    </select>
    <label>Section:</label>
    <select id="childSection">
      ${sections.map((s) => `<option>${s.sectionName}</option>`).join("")}
    </select>
    <button id="addChildBtn">Register Child</button>
  `;
  $("addChildBtn").onclick = async () => {
    const name = $("childName").value.trim().toLowerCase();
    const cls = $("childClass").value;
    const sec = $("childSection").value;
    if (!name) return alert("Enter child name.");
    await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
    alert("✅ Child Registered!");
    await updateStats();
  };
}

async function loadLinkParentChild() {
  currentMode = "link";
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  $("modeContent").innerHTML = `
    <h3>Link Parent and Child</h3>
    <label>Parent:</label>
    <select id="parentSelect">${parents.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
    <label>Children:</label>
    <select id="childSelect" multiple>${children.map((c) => `<option value="${c.id}">${c.name} (${c.class}-${c.section})</option>`).join("")}</select>
    <button id="linkBtn">Link Selected</button>
  `;
  $("linkBtn").onclick = async () => {
    const pid = $("parentSelect").value;
    const kids = Array.from($("childSelect").selectedOptions).map((o) => o.value);
    if (!pid || kids.length === 0) return alert("Select parent and child.");
    await window.dbAPI.addLink({ id: Date.now().toString(), parentId: pid, childrenIds: kids });
    alert("✅ Linked Successfully!");
  };
}

/* ============================================================
   Recognition Mode
   ============================================================ */
async function loadRecognitionMode() {
  currentMode = "recognition";
  $("modeContent").innerHTML = `
    <h3>Recognition Mode</h3>
    <div id="recognitionResult">Show a registered parent face...</div>
  `;
  await startCamera();
}

/* ============================================================
   Recognition Matcher
   ============================================================ */
async function buildMatcherFromDB() {
  const users = await window.dbAPI.getAllUsers();
  const labeled = [];
  for (const u of users) {
    if (u.descriptor && Array.isArray(u.descriptor)) {
      labeled.push(new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)]));
    }
  }
  recognitionMatcher = labeled.length ? new faceapi.FaceMatcher(labeled, 0.55) : null;
}

/* ============================================================
   Stats
   ============================================================ */
async function updateStats() {
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  $("parentCount").textContent = parents.length;
  $("childCount").textContent = children.length;
}

/* ============================================================
   Menu Setup
   ============================================================ */
function setupMenu() {
  $("btnAdmin").onclick = loadRegisterParent;
  $("btnClass").onclick = loadClassManager;
  $("btnChild").onclick = loadRegisterChild;
  $("btnLink").onclick = loadLinkParentChild;
  $("btnRecognition").onclick = loadRecognitionMode;
  $("refreshStatsBtn").onclick = updateStats;
}

/* ============================================================
   Initialization
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  video = $("video");
  overlay = $("overlay");
  ctx = overlay.getContext("2d");

  if (window.dbAPI && typeof window.dbAPI.openDB === "function") {
    await window.dbAPI.openDB();
  }
  setupMenu();
  await loadFaceModels();
  await populateCameraList();
  await buildMatcherFromDB();
  await updateStats();
  setStatus("✅ App Ready");
});
