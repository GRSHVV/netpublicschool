// index.js — Smart Pickup System (Full Stable Build with Working Linking & Recognition)
// ===========================================================

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
   HELPERS
===================================================== */
function setStatus(msg) {
  const el = document.getElementById("statusMsg");
  if (el) el.textContent = msg;
  console.log("[STATUS]", msg);
}
function safeGet(id) {
  return document.getElementById(id);
}

/* =====================================================
   MODEL LOADING
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
    alert("Camera permission required.");
    throw err;
  }
}
async function getVideoDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  videoDevices = devices.filter((d) => d.kind === "videoinput");
  const select = safeGet("cameraSelect");
  if (!select) return;
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
    const isBack = /back|rear|environment/i.test(
      e.target.options[e.target.selectedIndex].text.toLowerCase()
    );
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
    else constraints = { video: { facingMode: "user" }, audio: false };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = safeGet("video");
    if (!v) return;
    v.srcObject = stream;
    currentStream = stream;
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings();
    const isBack =
      settings.facingMode === "environment" ||
      /back|rear|environment/i.test(track.label);
    v.style.transform = isBack ? "none" : "scaleX(-1)";
    v.onloadedmetadata = () => {
      v.play();
      matchOverlayToVideo(v);
      setStatus(`🎥 Camera Active (${isBack ? "Back" : "Front"})`);
    };
  } catch (err) {
    console.error("switchCamera error:", err);
  }
}

/* =====================================================
   OVERLAY ALIGNMENT + DRAWING
===================================================== */
function matchOverlayToVideo(video) {
  const overlay = safeGet("overlay");
  if (!overlay || !video) return;
  const rect = video.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = rect.width * dpr;
  overlay.height = rect.height * dpr;
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
}
function drawAlignedDetections(video, overlay, detections, color = "lime") {
  if (!video || !overlay) return;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!video.videoWidth || !video.videoHeight) return;
  const dpr = window.devicePixelRatio || 1;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const ow = overlay.width / dpr;
  const oh = overlay.height / dpr;
  const scaleX = ow / vw;
  const scaleY = oh / vh;
  const isMirrored = (video.style.transform || "").includes("scaleX(-1)");
  ctx.save();
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = color;
  ctx.scale(dpr, dpr);
  detections.forEach((det) => {
    if (!det?.detection) return;
    const box = det.detection.box;
    let x = box.x * scaleX;
    let y = box.y * scaleY;
    let w = box.width * scaleX;
    let h = box.height * scaleY;
    if (isMirrored) x = ow - x - w;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.stroke();
  });
  ctx.restore();
}

/* =====================================================
   INIT
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  await window.dbAPI.openDB();
  await loadModels();
  await startCamera();
  bindMenuButtons();
  window.addEventListener("resize", () => matchOverlayToVideo(safeGet("video")));
  switchMode("admin");
});

/* =====================================================
   MENU
===================================================== */
function bindMenuButtons() {
  safeGet("btnAdmin")?.addEventListener("click", () => switchMode("admin"));
  safeGet("btnChild")?.addEventListener("click", () => switchMode("child"));
  safeGet("btnClass")?.addEventListener("click", () => switchMode("class"));
  safeGet("btnLink")?.addEventListener("click", () => switchMode("link"));
  safeGet("btnRecognition")?.addEventListener("click", () => switchMode("recognition"));
}

/* =====================================================
   MODE SWITCH
===================================================== */
function switchMode(mode) {
  currentMode = mode;
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
  const content = safeGet("modeContent");
  const cameraArea = safeGet("cameraArea");
  if (!content) return;
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
  safeGet("registerBtn")?.addEventListener("click", registerUser);
  setTimeout(() => {
    matchOverlayToVideo(safeGet("video"));
    detectParentFace();
  }, 500);
  loadParents();
}
function detectParentFace() {
  const v = safeGet("video"),
    o = safeGet("overlay"),
    btn = safeGet("registerBtn");
  adminDetectInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    const ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    if (det) {
      drawAlignedDetections(v, o, [det], "lime");
      lastDetection = det;
      lastDrawTime = Date.now();
      btn.disabled = !safeGet("username").value.trim();
    } else if (Date.now() - lastDrawTime > 3000) {
      lastDetection = null;
      btn.disabled = true;
    }
  }, 300);
}
async function registerUser() {
  const name = safeGet("username").value.trim().toLowerCase();
  const role = safeGet("role").value.toLowerCase();
  if (!name || !lastDetection) return alert("Face not detected or name missing!");
  const desc = Array.from(lastDetection.descriptor);
  await window.dbAPI.addUser({ id: Date.now().toString(), name, role, descriptor: desc });
  alert("Parent registered successfully!");
  loadParents();
}
async function loadParents() {
  const list = safeGet("userList");
  const users = await window.dbAPI.getAllUsers();
  list.innerHTML = users.length
    ? users.map((u) => `<li>${u.name} (${u.role})</li>`).join("")
    : "<li>No parents registered.</li>";
}

/* =====================================================
   CLASS & SECTION MANAGEMENT
===================================================== */
function renderClass(content) {
  content.innerHTML = `
    <h3>Manage Classes & Sections</h3>
    <label>Add Class</label><input id="className" placeholder="e.g. 10th"/>
    <button id="addClassBtn">Add</button>
    <ul id="classList"></ul><hr/>
    <label>Add Section</label><input id="sectionName" placeholder="e.g. a"/>
    <button id="addSectionBtn">Add</button>
    <ul id="sectionList"></ul>`;
  safeGet("addClassBtn").onclick = async () => {
    const name = safeGet("className").value.trim().toLowerCase();
    if (!name) return;
    await window.dbAPI.addClass(name);
    loadClassList();
  };
  safeGet("addSectionBtn").onclick = async () => {
    const name = safeGet("sectionName").value.trim().toLowerCase();
    if (!name) return;
    await window.dbAPI.addSection(name);
    loadSectionList();
  };
  loadClassList();
  loadSectionList();
}
async function loadClassList() {
  const list = safeGet("classList");
  const classes = await window.dbAPI.getAllClasses();
  list.innerHTML = classes.length
    ? classes.map((x) => `<li>${x.name}</li>`).join("")
    : "<li>No classes.</li>";
}
async function loadSectionList() {
  const list = safeGet("sectionList");
  const sections = await window.dbAPI.getAllSections();
  list.innerHTML = sections.length
    ? sections.map((x) => `<li>${x.name}</li>`).join("")
    : "<li>No sections.</li>";
}

/* =====================================================
   CHILD REGISTRATION
===================================================== */
async function renderChild(content) {
  content.innerHTML = `
    <h3>Register Child</h3>
    <label>Name</label><input id="childName" placeholder="name"/>
    <label>Class</label><select id="childClass"></select>
    <label>Section</label><select id="childSection"></select>
    <button id="addChildBtn" class="primary">Add Child</button>
    <ul id="childList"></ul>`;
  await loadClassSectionOptions("childClass", "childSection");
  safeGet("addChildBtn").onclick = addChild;
  loadChildren();
}
async function addChild() {
  const name = safeGet("childName").value.trim().toLowerCase();
  const cls = safeGet("childClass").value.toLowerCase();
  const sec = safeGet("childSection").value.toLowerCase();
  if (!name || !cls || !sec) return alert("Fill all fields.");
  await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
  safeGet("childName").value = "";
  loadChildren();
}
async function loadChildren() {
  const kids = await window.dbAPI.getAllChildren();
  safeGet("childList").innerHTML = kids.length
    ? kids.map((c) => `<li>${c.name} (${c.class}-${c.section})</li>`).join("")
    : "<li>No children registered.</li>";
}
async function loadClassSectionOptions(cid, sid) {
  const cs = await window.dbAPI.getAllClasses();
  const ss = await window.dbAPI.getAllSections();
  safeGet(cid).innerHTML = cs.map((c) => `<option>${c.name}</option>`).join("");
  safeGet(sid).innerHTML = ss.map((s) => `<option>${s.name}</option>`).join("");
}

/* =====================================================
   LINK PARENT–CHILD MODULE (FIXED)
===================================================== */
async function renderLinkMode(content) {
  content.innerHTML = `
    <h3>Link Parents & Children</h3>
    <label>Search Parent</label>
    <input id="parentSearch" placeholder="Type first 3 letters..."/>
    <select id="parentSelect" size="4"></select>
    <label>Class</label><select id="linkClass"></select>
    <label>Section</label><select id="linkSection"></select>
    <label>Search Child</label>
    <input id="childSearch" placeholder="Type first 3 letters..." disabled/>
    <select id="childrenSelect" multiple size="6"></select>
    <button id="linkBtn" class="primary">Link Selected</button>
    <ul id="linkList"></ul>`;
  await loadClassSectionOptions("linkClass", "linkSection");
  setupLinkHandlers();
  loadLinks();
}
function setupLinkHandlers() {
  const parentSearch = safeGet("parentSearch");
  const parentSelect = safeGet("parentSelect");
  const classSelect = safeGet("linkClass");
  const sectionSelect = safeGet("linkSection");
  const childSearch = safeGet("childSearch");
  const childrenSelect = safeGet("childrenSelect");
  const linkBtn = safeGet("linkBtn");

  function updateState() {
    const enabled = parentSelect.value && classSelect.value && sectionSelect.value;
    childSearch.disabled = !enabled;
  }

  parentSearch.oninput = async () => {
    const term = parentSearch.value.trim().toLowerCase();
    parentSelect.innerHTML = "";
    if (term.length >= 3) {
      const parents = await window.dbAPI.getAllUsers();
      const matches = parents.filter((p) => p.name.startsWith(term));
      matches.forEach((p) => {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = `${p.name} (${p.role})`;
        parentSelect.appendChild(o);
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
      const all = await window.dbAPI.getAllChildren();
      const matches = all.filter(
        (c) =>
          c.name.startsWith(term) &&
          c.class.toLowerCase() === cls &&
          c.section.toLowerCase() === sec
      );
      matches.forEach((c) => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = `${c.name} (${c.class}-${c.section})`;
        childrenSelect.appendChild(o);
      });
    }
  };

  linkBtn.onclick = async () => {
    const parentId = parentSelect.value;
    const selected = Array.from(childrenSelect.selectedOptions).map((o) => o.value);
    if (!parentId || !selected.length) return alert("Select parent and children first!");
    await window.dbAPI.linkParentChildren(parentId, selected);
    alert("Parent linked successfully!");
    loadLinks();
  };
}
async function loadLinks() {
  const list = safeGet("linkList");
  const links = await window.dbAPI.getAllLinks();
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  list.innerHTML = links.length
    ? links
        .map((l) => {
          const p = parents.find((x) => x.id === l.parentId);
          const kids = l.childrenIds
            .map((cid) => {
              const c = children.find((y) => y.id === cid);
              return c ? `${c.name} (${c.class}-${c.section})` : "";
            })
            .join(", ");
          return `<li>${p ? p.name : "(unknown)"} → ${kids}</li>`;
        })
        .join("")
    : "<li>No links found.</li>";
}

/* =====================================================
   RECOGNITION MODE
===================================================== */
function renderRecognition(content) {
  content.innerHTML = `
    <h3>Recognition</h3>
    <div id="recognitionResult" class="result-box"
      style="font-size:1.4rem;font-weight:600;padding:15px;border-radius:10px;background:#f9fafb;min-height:150px;">
      Waiting for face...
    </div>`;
  const back = videoDevices.find((d) =>
    /back|rear|environment/i.test((d.label || "").toLowerCase())
  );
  if (back) switchCamera(back.deviceId, true).catch(() => {});
  startRecognition();
}
async function startRecognition() {
  if (recognitionInterval) clearInterval(recognitionInterval);
  const users = await window.dbAPI.getAllUsers();
  const links = await window.dbAPI.getAllLinks();
  const children = await window.dbAPI.getAllChildren();
  if (!users.length) {
    safeGet("recognitionResult").innerHTML = "<p>No registered parents.</p>";
    return;
  }
  const labeled = users.map(
    (u) => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)])
  );
  const matcher = new faceapi.FaceMatcher(labeled, 0.6);
  const v = safeGet("video");
  const o = safeGet("overlay");
  const box = safeGet("recognitionResult");
  recognitionInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.49 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    const ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    if (!det) return;
    const best = matcher.findBestMatch(det.descriptor);
    const color = best.label === "unknown" ? "red" : "lime";
    drawAlignedDetections(v, o, [det], color);
    if (best.label === "unknown") {
      box.innerHTML = `<div style="background:#fee2e2;padding:15px;border-radius:10px;color:#b91c1c;">
        <h2>❌ Unrecognized Face</h2><p>Please check registration.</p></div>`;
      return;
    }
    const parent = users.find((u) => u.name === best.label);
    const link = links.find((l) => l.parentId === parent?.id);
    const kids = (link?.childrenIds || [])
      .map((cid) => {
        const c = children.find((x) => x.id === cid);
        return c ? `<li style="font-size:1.3rem;">👧 ${c.name} (${c.class}-${c.section})</li>` : "";
      })
      .join("");
    box.innerHTML = `<div style="background:#dcfce7;padding:15px;border-radius:10px;color:#166534;">
      <h2>✅ Recognized: ${best.label}</h2>
      ${kids ? `<h3>Linked Children:</h3><ul>${kids}</ul>` : "<p>No linked children</p>"}</div>`;
  }, 400);
}

window.addEventListener("beforeunload", () => {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
});

