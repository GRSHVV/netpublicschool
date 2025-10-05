// index.js — Smart Pickup System (Final Complete Version)
// ===========================================================
// Features: Face Registration, Recognition, Class/Section, Parent-Child Linking
// Author: Girish Vijayapura (2025)

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let videoDevices = [];
let currentDeviceId = null;
let lastDetection = null;
let lastDrawTime = 0;

/* =====================================================
   STATUS HELPER
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
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
}

/* =====================================================
   LOAD MODELS
===================================================== */
async function loadModels() {
  setStatus("Loading models...");
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
  ]);
  modelsLoaded = true;
  setStatus("Models loaded ✅");
}

/* =====================================================
   CAMERA HANDLING
===================================================== */
async function ensureCameraPermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert("Camera permission is required. Please enable it in browser settings.");
    throw err;
  }
}

async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  const select = document.getElementById("cameraSelect");
  select.innerHTML = "";
  videoDevices.forEach((device, i) => {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.textContent = device.label || `Camera ${i + 1}`;
    select.appendChild(opt);
  });
  if (!currentDeviceId && videoDevices.length) {
    const back = videoDevices.find((d) => /back|rear|environment/i.test(d.label));
    currentDeviceId = back ? back.deviceId : videoDevices[0].deviceId;
  }
  select.value = currentDeviceId || "";
  select.onchange = async (e) => {
    const newId = e.target.value;
    const text = e.target.options[e.target.selectedIndex].text.toLowerCase();
    const isBack = /back|rear|environment/.test(text);
    await switchCamera(newId, isBack);
  };
}

async function startCamera() {
  await ensureCameraPermission();
  await getVideoDevices();
  await switchCamera(currentDeviceId, false);
}

async function switchCamera(deviceId, preferBack = false) {
  try {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }

    let constraints;
    if (preferBack)
      constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    else if (deviceId)
      constraints = { video: { deviceId: { exact: deviceId } }, audio: false };
    else
      constraints = { video: { facingMode: "user" }, audio: false };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = document.getElementById("video");
    v.srcObject = stream;
    currentStream = stream;

    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const isBackCamera =
      settings.facingMode === "environment" ||
      /back|rear|environment/i.test(track.label);

    v.style.transform = isBackCamera ? "none" : "scaleX(-1)";

    v.onloadedmetadata = () => {
      v.play();
      matchOverlayToVideo(v);
      setStatus(`🎥 Camera Active (${isBackCamera ? "Back" : "Front"})`);
    };
  } catch (err) {
    console.error("switchCamera error:", err);
    alert("Failed to access selected camera.");
  }
}

function matchOverlayToVideo(video) {
  const o = document.getElementById("overlay");
  const rect = video.getBoundingClientRect();
  o.width = rect.width * window.devicePixelRatio;
  o.height = rect.height * window.devicePixelRatio;
  o.style.width = rect.width + "px";
  o.style.height = rect.height + "px";
}

/* =====================================================
   DETECTION DRAWING
===================================================== */
function drawAlignedDetections(video, overlay, detections) {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  const scaleX = overlay.width / video.videoWidth;
  const scaleY = overlay.height / video.videoHeight;
  const isMirrored = video.style.transform.includes("scaleX(-1)");

  detections.forEach((det) => {
    const { x, y, width, height } = det.detection.box;
    const drawX = isMirrored ? overlay.width - (x + width) * scaleX : x * scaleX;
    const drawY = y * scaleY;
    ctx.strokeStyle = det.color || "green";
    ctx.lineWidth = 3;
    ctx.strokeRect(drawX, drawY, width * scaleX, height * scaleY);
  });
}

/* =====================================================
   INIT
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  bindMenuButtons();
  window.addEventListener("resize", () => matchOverlayToVideo(document.getElementById("video")));
});

/* =====================================================
   MENU
===================================================== */
function bindMenuButtons() {
  document.getElementById("btnAdmin")?.addEventListener("click", () => switchMode("admin"));
  document.getElementById("btnChild")?.addEventListener("click", () => switchMode("child"));
  document.getElementById("btnClass")?.addEventListener("click", () => switchMode("class"));
  document.getElementById("btnLink")?.addEventListener("click", () => switchMode("link"));
  document.getElementById("btnRecognition")?.addEventListener("click", () => switchMode("recognition"));
}

/* =====================================================
   MODE SWITCH
===================================================== */
function switchMode(mode) {
  currentMode = mode;
  clearIntervals();
  const content = document.getElementById("modeContent");
  const cameraArea = document.getElementById("cameraArea");
  if (["child", "class"].includes(mode)) cameraArea.classList.add("camera-hidden");
  else cameraArea.classList.remove("camera-hidden");
  if (mode === "admin") renderAdmin(content);
  if (mode === "child") renderChild(content);
  if (mode === "class") renderClass(content);
  if (mode === "link") renderLinkMode(content);
  if (mode === "recognition") renderRecognition(content);
}

/* =====================================================
   ADMIN (REGISTER PARENT)
===================================================== */
function renderAdmin(content) {
  content.innerHTML = `
    <h3>Register Parent</h3>
    <label>Name</label><input id="username" placeholder="name"/>
    <label>Role</label><select id="role"><option>father</option><option>mother</option><option>guardian</option></select>
    <button id="registerBtn" class="primary" disabled>Register</button>
    <ul id="userList"></ul>`;
  document.getElementById("registerBtn").addEventListener("click", registerUser);
  detectParentFace();
  loadParents();
}

function detectParentFace() {
  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const btn = document.getElementById("registerBtn");
  adminDetectInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    const ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    if (det) {
      drawAlignedDetections(v, o, [det]);
      lastDetection = det;
      lastDrawTime = Date.now();
      btn.disabled = !document.getElementById("username").value.trim();
    } else if (Date.now() - lastDrawTime > 3000) {
      ctx.clearRect(0, 0, o.width, o.height);
      lastDetection = null;
      btn.disabled = true;
    }
  }, 250);
}

async function registerUser() {
  const name = document.getElementById("username").value.trim().toLowerCase();
  const role = document.getElementById("role").value.toLowerCase();
  if (!name || !lastDetection) return alert("Face not detected or name missing!");
  const desc = Array.from(lastDetection.descriptor);
  await window.dbAPI.addUser({ id: Date.now().toString(), name, role, descriptor: desc });
  alert("Parent registered successfully!");
  loadParents();
}

async function loadParents() {
  const list = document.getElementById("userList");
  const users = await window.dbAPI.getAllUsers();
  list.innerHTML = users.length
    ? users.map((u) => `<li>${u.name} (${u.role})</li>`).join("")
    : "<li>No parents registered.</li>";
}

/* =====================================================
   LINK MODE (Parent → Class → Section → Child)
===================================================== */
function renderLinkMode(content) {
  content.innerHTML = `
    <h3>Link Parents & Children</h3>
    <label>Search Parent (min 3 letters)</label>
    <input id="parentSearch" placeholder="type first 3 letters" />
    <select id="parentSelect" size="4" style="width:100%"></select>
    <label>Select Class</label><select id="linkClass"></select>
    <label>Select Section</label><select id="linkSection"></select>
    <label>Search Child (min 3 letters)</label>
    <input id="childSearch" placeholder="type child name" disabled />
    <select id="childrenSelect" multiple size="5" style="width:100%"></select>
    <button id="linkBtn" class="primary">Link Selected</button>
    <div id="linkHint" style="color:#f59e0b;font-size:0.8rem;"></div>
    <hr/><ul id="linkList"></ul>`;
  loadClassSectionOptions("linkClass", "linkSection").then(() => setupLinkHandlers());
  loadLinks();
}

function setupLinkHandlers() {
  const parentSearch = document.getElementById("parentSearch");
  const parentSelect = document.getElementById("parentSelect");
  const classSelect = document.getElementById("linkClass");
  const sectionSelect = document.getElementById("linkSection");
  const childSearch = document.getElementById("childSearch");
  const childrenSelect = document.getElementById("childrenSelect");
  const hint = document.getElementById("linkHint");

  function updateState() {
    const ok = parentSelect.value && classSelect.value && sectionSelect.value;
    childSearch.disabled = !ok;
    hint.textContent = ok ? "" : "Select parent, class & section first";
  }

  parentSearch.oninput = async () => {
    const term = parentSearch.value.trim().toLowerCase();
    parentSelect.innerHTML = "";
    if (term.length >= 3) {
      const parents = await window.dbAPI.getAllUsers();
      parents
        .filter((p) => p.name.startsWith(term))
        .forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.role})`;
          parentSelect.appendChild(opt);
        });
    }
    updateState();
  };

  [parentSelect, classSelect, sectionSelect].forEach((el) =>
    el.addEventListener("change", updateState)
  );

  childSearch.oninput = async () => {
    const term = childSearch.value.trim().toLowerCase();
    const cls = classSelect.value.toLowerCase();
    const sec = sectionSelect.value.toLowerCase();
    childrenSelect.innerHTML = "";
    if (term.length >= 3) {
      const allChildren = await window.dbAPI.getAllChildren();
      allChildren
        .filter(
          (c) =>
            c.name.startsWith(term) &&
            c.class.toLowerCase() === cls &&
            c.section.toLowerCase() === sec
        )
        .forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.class}-${c.section})`;
          childrenSelect.appendChild(opt);
        });
    }
  };

  document.getElementById("linkBtn").onclick = async () => {
    const parentId = parentSelect.value;
    const selectedChildren = Array.from(childrenSelect.selectedOptions).map((o) => o.value);
    if (!parentId || !selectedChildren.length)
      return alert("Select parent and child to link.");
    await window.dbAPI.linkParentChildren(parentId, selectedChildren);
    alert("Linked successfully!");
    loadLinks();
  };
}

async function loadLinks() {
  const list = document.getElementById("linkList");
  const links = await window.dbAPI.getAllLinks();
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  list.innerHTML = links
    .map((l) => {
      const p = parents.find((x) => x.id === l.parentId);
      const kids = (l.childrenIds || [])
        .map((cid) => {
          const ch = children.find((c) => c.id === cid);
          return ch ? `${ch.name} (${ch.class}-${ch.section})` : "";
        })
        .join(", ");
      return `<li><strong>${p?.name}</strong> → ${kids}</li>`;
    })
    .join("") || "<li>No links found.</li>";
}

/* =====================================================
   FACE RECOGNITION
===================================================== */
async function renderRecognition(content) {
  content.innerHTML = `<h3>Recognition</h3><div id="recognitionResult"></div>`;
  const back = videoDevices.find((d) => /back|rear|environment/i.test((d.label || "").toLowerCase()));
  if (back) await switchCamera(back.deviceId, true);
  startRecognition();
}

async function startRecognition() {
  const users = await window.dbAPI.getAllUsers();
  const links = await window.dbAPI.getAllLinks();
  const children = await window.dbAPI.getAllChildren();
  if (!users.length) return setStatus("⚠️ No registered parents found.");

  const labeled = users.map(
    (u) => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)])
  );
  const matcher = new faceapi.FaceMatcher(labeled, 0.6);

  const v = document.getElementById("video");
  const o = document.getElementById("overlay");
  const ctx = o.getContext("2d");
  const resultBox = document.getElementById("recognitionResult");

  recognitionInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, o.width, o.height);
    if (!det) return;

    drawAlignedDetections(v, o, [det]);
    const best = matcher.findBestMatch(det.descriptor);
    if (best.label === "unknown") {
      resultBox.innerHTML = `<p style='color:red;font-weight:bold;'>❌ Unrecognized face</p>`;
      return;
    }

    const parent = users.find((u) => u.name === best.label);
    const link = links.find((l) => l.parentId === parent?.id);
    const kidsHtml = (link?.childrenIds || [])
      .map((cid) => {
        const ch = children.find((c) => c.id === cid);
        return ch ? `<li>${ch.name} (${ch.class}-${ch.section})</li>` : "";
      })
      .join("");

    resultBox.innerHTML = `
      <p style='color:green;font-weight:bold;'>✅ Recognized: ${best.label}</p>
      ${
        kidsHtml
          ? `<p><strong>Linked Children:</strong></p><ul>${kidsHtml}</ul>`
          : "<p>No linked children found</p>"
      }
    `;
  }, 400);
}
