"use strict";

/* ============================================================
   Smart Pickup App - Final Version with Conditional Camera View
   ============================================================ */

let video, overlay, ctx;
let modelsLoaded = false;
let detectionLoop = null;
let currentMode = "none";
let currentCameraId = null;
let allVideoDevices = [];
let recognitionMatcher = null;
let lastDetection = null;

/* ============================================================
   Helpers
   ============================================================ */
const $ = (id) => document.getElementById(id);
const log = (...a) => console.log("[LOG]", ...a);
const setStatus = (msg) => { if ($("statusMsg")) $("statusMsg").textContent = msg; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function playBeep(durationMs = 120, freq = 1000, type = "sine") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.value = 0.05;
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, durationMs);
  } catch (e) {
    console.warn("Audio not supported", e);
  }
}

/* ============================================================
   Face API Model Loading
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
    setStatus("✅ Models loaded.");
  } catch (e) {
    console.error("Model load error:", e);
    alert("❌ Failed to load models. Check ./models folder and paths.");
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

    select.onchange = async () => await startCamera(select.value);
    if (allVideoDevices.length > 0 && !currentCameraId) {
      currentCameraId = allVideoDevices[0].deviceId;
      select.value = currentCameraId;
    }
  } catch (e) {
    console.error("Camera list error:", e);
  }
}

async function startCamera(deviceId = null) {
  try {
    stopCamera();
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
    alert("❌ Camera permission denied or unavailable.");
  }
}

function stopCamera() {
  clearInterval(detectionLoop);
  if (video?.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  ctx?.clearRect(0, 0, overlay.width, overlay.height);
  setStatus("Camera stopped");
}

/* ============================================================
   Face Detection & Recognition (3 Colors)
   ============================================================ */
async function startDetectionLoop() {
  if (!modelsLoaded) return;
  clearInterval(detectionLoop);

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

  detectionLoop = setInterval(async () => {
    try {
      if (!video || video.readyState < 2) return;

      const detection = await faceapi
        .detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const resultDiv = $("recognitionResult");

      if (!detection) {
        lastDetection = null;
        if (currentMode === "recognition" && resultDiv)
          resultDiv.innerHTML = `<p style="opacity:0.6">Show a registered face...</p>`;
        $("registerBtn")?.setAttribute("disabled", true);
        return;
      }

      lastDetection = detection;
      const box = detection.detection.box;
      const scaleX = overlay.width / video.videoWidth;
      const scaleY = overlay.height / video.videoHeight;
      const drawBox = {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      };

      // -------- Registration Mode --------
      if (currentMode === "registerParent") {
        ctx.strokeStyle = "yellow";
        ctx.lineWidth = 2;
        ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
        $("registerBtn")?.removeAttribute("disabled");
        return;
      }

      // -------- Recognition Mode --------
      if (currentMode === "recognition" && recognitionMatcher) {
        const best = recognitionMatcher.findBestMatch(detection.descriptor);

        if (best.label === "unknown") {
          ctx.strokeStyle = "red";
          ctx.lineWidth = 3;
          ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
          resultDiv.innerHTML = `<p style="color:#b91c1c;font-weight:bold;">❌ Unrecognized Face</p>`;
          playBeep(400, 200, "sine");
          return;
        }

        // Recognized
        const users = await window.dbAPI.getAllUsers();
        const parent = users.find((u) => u.name === best.label);
        if (!parent) return;

        const links = await window.dbAPI.getAllLinks();
        const children = await window.dbAPI.getAllChildren();
        const linked = links
          .filter((l) => l.parentId === parent.id)
          .flatMap((l) => l.childrenIds || [])
          .map((id) => children.find((c) => c.id === id))
          .filter(Boolean);

        if (linked.length > 0) {
          ctx.strokeStyle = "lime";
          playBeep(100, 1000, "square");
          const kidsHtml = linked
            .map((c) => `<li>${c.name} (${c.class}-${c.section})</li>`)
            .join("");
          resultDiv.innerHTML = `
            <p style="color:#22c55e;font-weight:bold;">✅ Recognized: ${best.label}</p>
            <p>Linked Children:</p>
            <ul>${kidsHtml}</ul>
            <button id="auditBtn">Mark Pickup</button>
          `;
        } else {
          ctx.strokeStyle = "yellow";
          playBeep(200, 800, "triangle");
          resultDiv.innerHTML = `
            <p style="color:#eab308;font-weight:bold;">⚠️ Recognized: ${best.label}</p>
            <p>No linked children found.</p>
          `;
        }

        ctx.lineWidth = 3;
        ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);

        const auditBtn = $("auditBtn");
        if (auditBtn && linked.length > 0) {
          auditBtn.onclick = async () => {
            for (const ch of linked) {
              await window.dbAPI.addAudit({
                id: Date.now().toString(),
                parentId: parent.id,
                childId: ch.id,
                timestamp: Date.now(),
              });
            }
            alert("✅ Pickup logged!");
          };
        }
      }
    } catch (err) {
      console.error("Detection loop error:", err);
    }
  }, 600);
}

/* ============================================================
   Database-Linked Logic
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
   Admin & UI Modules
   ============================================================ */
function toggleCameraVisibility(show) {
  const display = show ? "block" : "none";
  if (video) video.style.display = display;
  if (overlay) overlay.style.display = display;
}

async function loadRegisterParent() {
  currentMode = "registerParent";
  toggleCameraVisibility(true);
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
  toggleCameraVisibility(false);
  stopCamera();
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
  toggleCameraVisibility(false);
  stopCamera();
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
  toggleCameraVisibility(false);
  stopCamera();
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

async function loadRecognitionMode() {
  currentMode = "recognition";
  toggleCameraVisibility(true);
  $("modeContent").innerHTML = `
    <h3>Recognition Mode</h3>
    <div id="recognitionResult">Show a registered face...</div>
  `;
  await startCamera();
}

/* ============================================================
   Stats and Menu Setup
   ============================================================ */
async function updateStats() {
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  $("parentCount").textContent = parents.length;
  $("childCount").textContent = children.length;
}

function setupMenu() {
  const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  bind("btnAdmin", loadRegisterParent);
  bind("btnClass", loadClassManager);
  bind("btnChild", loadRegisterChild);
  bind("btnLink", loadLinkParentChild);
  bind("btnRecognition", loadRecognitionMode);
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
  toggleCameraVisibility(false); // hidden by default
  setStatus("✅ App Ready");
});
