// index.js — Smart Pickup System (Complete Final Version)
// ======================================================
// Includes: camera handling, face-api model loading, admin (parent) registration,
// class & section management, child registration, parent-child linking, recognition.
// All text fields normalized to lowercase before save/compare.
// Works with window.dbAPI (db.js), face-api.min.js, index.html, style.css

/* =====================================================
   GLOBAL STATE
===================================================== */
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
   STATUS / UTIL HELPERS
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
   INDEXEDDB (window.dbAPI must be available)
   (DB API assumed: openDB, addUser, getAllUsers, addClass, getAllClasses,
    addSection, getAllSections, addChild, getAllChildren, linkParentChildren,
    getAllLinks)
===================================================== */

/* =====================================================
   FACE-API MODELS
===================================================== */
async function loadModels() {
  setStatus("Loading models...");
  // Ensure models folder path is correct relative to index.html
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
    faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
    faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
  ]);
  modelsLoaded = true;
  setStatus("Models loaded ✅");
}

/* =====================================================
   CAMERA: enumerate, switch, start
===================================================== */
async function ensureCameraPermission() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    alert("Camera permission required. Please allow camera access.");
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
    if (preferBack) {
      constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    } else if (deviceId) {
      constraints = { video: { deviceId: { exact: deviceId } }, audio: false };
    } else {
      constraints = { video: { facingMode: "user" }, audio: false };
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = safeGet("video");
    if (!v) return;
    v.srcObject = stream;
    currentStream = stream;

    // Detect if it's back camera via track settings/label
    const track = stream.getVideoTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    const isBackCamera =
      (settings && settings.facingMode === "environment") ||
      /back|rear|environment/i.test(track.label || "");

    // Mirror front camera only
    v.style.transform = isBackCamera ? "none" : "scaleX(-1)";

    v.onloadedmetadata = () => {
      v.play();
      matchOverlayToVideo(v);
      setStatus(`🎥 Camera Active (${isBackCamera ? "Back" : "Front"})`);
    };
  } catch (err) {
    console.error("switchCamera error:", err);
    setStatus("Camera error");
    alert("Cannot access selected camera. Check permissions and try again.");
  }
}

/* =====================================================
   OVERLAY ALIGNMENT & DRAW HELPERS
===================================================== */
function matchOverlayToVideo(video) {
  const overlay = safeGet("overlay");
  if (!overlay || !video) return;
  // Use bounding rect for displayed size, multiply by DPR for crisp drawing
  const rect = video.getBoundingClientRect();
  // If video hasn't reported size yet, use offsets as fallback
  const w = video.videoWidth || rect.width || video.offsetWidth;
  const h = video.videoHeight || rect.height || video.offsetHeight;

  // overlay dimensions in device pixels
  overlay.width = w * window.devicePixelRatio;
  overlay.height = h * window.devicePixelRatio;
  // overlay size in CSS pixels to match video display
  overlay.style.width = rect.width + "px";
  overlay.style.height = rect.height + "px";
}

function drawAlignedDetections(video, overlay, detections) {
  if (!video || !overlay) return;
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  // If video has no resolution yet, bail
  if (!video.videoWidth || !video.videoHeight) return;

  const scaleX = overlay.width / video.videoWidth;
  const scaleY = overlay.height / video.videoHeight;
  const isMirrored = (video.style.transform || "").includes("scaleX(-1)");

  detections.forEach((det) => {
    if (!det || !det.detection) return;
    const box = det.detection.box;
    const x = box.x, y = box.y, w = box.width, h = box.height;
    const drawX = isMirrored ? overlay.width - (x + w) * scaleX : x * scaleX;
    const drawY = y * scaleY;
    ctx.lineWidth = 3;
    ctx.strokeStyle = det.color || "lime";
    ctx.strokeRect(drawX, drawY, w * scaleX, h * scaleY);
  });
}

/* =====================================================
   INITIALIZE APP
===================================================== */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await window.dbAPI.openDB();
  } catch (e) {
    console.error("DB open failed:", e);
  }

  try {
    await loadModels();
  } catch (e) {
    console.error("Model load error:", e);
    setStatus("Model load failed");
  }

  try {
    await startCamera();
  } catch (e) {
    console.warn("Camera start failed:", e);
    setStatus("Camera start failed");
  }

  bindMenuButtons();

  // Keep overlay synced on resize
  window.addEventListener("resize", () => {
    const v = safeGet("video");
    if (v) matchOverlayToVideo(v);
  });

  // initial mode
  switchMode("admin");
});

/* =====================================================
   MENU BINDINGS
===================================================== */
function bindMenuButtons() {
  safeGet("btnAdmin")?.addEventListener("click", () => switchMode("admin"));
  safeGet("btnChild")?.addEventListener("click", () => switchMode("child"));
  safeGet("btnClass")?.addEventListener("click", () => switchMode("class"));
  safeGet("btnLink")?.addEventListener("click", () => switchMode("link"));
  safeGet("btnRecognition")?.addEventListener("click", () => switchMode("recognition"));

  safeGet("btnStartCamera")?.addEventListener("click", async () => {
    try { await startCamera(); } catch (e) { console.error(e); }
  });
  safeGet("btnRefreshDevices")?.addEventListener("click", async () => {
    try { await getVideoDevices(); } catch (e) { console.error(e); }
  });
}

/* =====================================================
   MODE SWITCHER
===================================================== */
function switchMode(mode) {
  currentMode = mode;
  // clear intervals safely
  if (adminDetectInterval) { clearInterval(adminDetectInterval); adminDetectInterval = null; }
  if (recognitionInterval) { clearInterval(recognitionInterval); recognitionInterval = null; }

  const content = safeGet("modeContent");
  const cameraArea = safeGet("cameraArea");
  if (!content) return;

  // hide camera for child/class modules
  if (["child", "class"].includes(mode)) cameraArea.classList.add("camera-hidden");
  else cameraArea.classList.remove("camera-hidden");

  if (mode === "admin") renderAdmin(content);
  if (mode === "child") renderChild(content);
  if (mode === "class") renderClass(content);
  if (mode === "link") renderLinkMode(content);
  if (mode === "recognition") renderRecognition(content);
}

/* =====================================================
   ADMIN (PARENT) REGISTRATION
   -> Fixes: ensures overlay sync before detection begins
===================================================== */
function renderAdmin(content) {
  content.innerHTML = `
    <h3>Register Parent</h3>
    <div class="form-group">
      <label>Name</label>
      <input id="username" placeholder="enter parent name"/>
    </div>
    <div class="form-group">
      <label>Role</label>
      <select id="role"><option>father</option><option>mother</option><option>guardian</option></select>
    </div>
    <button id="registerBtn" class="primary" disabled>Register</button>
    <hr/>
    <h4>Registered Parents</h4>
    <ul id="userList"></ul>
  `;

  safeGet("registerBtn")?.addEventListener("click", registerUser);

  // small delay to ensure camera has been resized / video displayed before detection
  setTimeout(() => {
    // ensure overlay size matches
    const v = safeGet("video");
    if (v) matchOverlayToVideo(v);
    // start face detection loop for registration
    startAdminDetection();
  }, 500);

  loadParents();
  // enable register button when name typed (and face is detected)
  const uname = safeGet("username");
  if (uname) {
    uname.addEventListener("input", () => {
      const btn = safeGet("registerBtn");
      if (btn) btn.disabled = !(uname.value.trim() && lastDetection);
    });
  }
}

function startAdminDetection() {
  // clear previous interval if any
  if (adminDetectInterval) { clearInterval(adminDetectInterval); adminDetectInterval = null; }

  const v = safeGet("video");
  const o = safeGet("overlay");
  const btn = safeGet("registerBtn");
  if (!v || !o) return;

  adminDetectInterval = setInterval(async () => {
    try {
      if (!modelsLoaded || !v.videoWidth) return;
      // ensure overlay dimensions aligned to video
      matchOverlayToVideo(v);

      const detection = await faceapi
        .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.33 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      // clear overlay
      const ctx = o.getContext("2d");
      ctx.clearRect(0, 0, o.width, o.height);

      if (detection) {
        // draw box aligned to displayed video
        drawAlignedDetections(v, o, [detection]);
        lastDetection = detection;
        lastDrawTime = Date.now();
        if (btn) btn.disabled = !safeGet("username").value.trim();
      } else {
        // if no detection for 3s, clear detection
        if (Date.now() - lastDrawTime > 3000) {
          lastDetection = null;
          if (btn) btn.disabled = true;
        }
      }
    } catch (e) {
      console.error("admin detection error:", e);
    }
  }, 250);
}

async function registerUser() {
  const nameEl = safeGet("username");
  const roleEl = safeGet("role");
  if (!nameEl || !roleEl) return alert("Missing fields");
  const name = nameEl.value.trim().toLowerCase();
  const role = roleEl.value.trim().toLowerCase();
  if (!name) return alert("Enter name");
  if (!lastDetection) return alert("No face detected. Show face in camera.");
  // descriptor to array
  const descriptor = Array.from(lastDetection.descriptor || []);
  const user = { id: Date.now().toString(), name, role, descriptor };
  try {
    await window.dbAPI.addUser(user);
    alert("Parent registered");
    nameEl.value = "";
    loadParents();
  } catch (e) {
    console.error("addUser error:", e);
    alert("Failed to register parent.");
  }
}

async function loadParents() {
  const list = safeGet("userList");
  if (!list) return;
  try {
    const users = await window.dbAPI.getAllUsers();
    if (!Array.isArray(users)) { list.innerHTML = "<li>Error loading parents</li>"; return; }
    list.innerHTML = users.length
      ? users.map((u) => `<li class="list-item">${u.name} (${u.role})</li>`).join("")
      : "<li>No parents registered.</li>";
  } catch (e) {
    console.error("loadParents error:", e);
    list.innerHTML = "<li>Error loading parents</li>";
  }
}

/* =====================================================
   CLASS & SECTION MANAGEMENT
===================================================== */
function renderClass(content) {
  content.innerHTML = `
    <h3>Manage Classes & Sections</h3>
    <div class="form-group">
      <label>Add Class</label>
      <input id="className" placeholder="e.g. 10th"/>
      <button id="addClassBtn" class="primary small">Add</button>
    </div>
    <ul id="classList"></ul>
    <hr/>
    <div class="form-group">
      <label>Add Section</label>
      <input id="sectionName" placeholder="e.g. a"/>
      <button id="addSectionBtn" class="primary small">Add</button>
    </div>
    <ul id="sectionList"></ul>
  `;
  safeGet("addClassBtn")?.addEventListener("click", addClass);
  safeGet("addSectionBtn")?.addEventListener("click", addSection);
  loadClassList();
  loadSectionList();
}

async function addClass() {
  const el = safeGet("className");
  if (!el) return;
  const name = el.value.trim().toLowerCase();
  if (!name) return alert("Enter class name");
  try {
    await window.dbAPI.addClass(name);
    el.value = "";
    loadClassList();
  } catch (e) {
    console.error("addClass error:", e);
    alert("Failed to add class");
  }
}

async function addSection() {
  const el = safeGet("sectionName");
  if (!el) return;
  const name = el.value.trim().toLowerCase();
  if (!name) return alert("Enter section name");
  try {
    await window.dbAPI.addSection(name);
    el.value = "";
    loadSectionList();
  } catch (e) {
    console.error("addSection error:", e);
    alert("Failed to add section");
  }
}

async function loadClassList() {
  const el = safeGet("classList");
  if (!el) return;
  try {
    const list = await window.dbAPI.getAllClasses();
    el.innerHTML = Array.isArray(list) && list.length
      ? list.map((c) => `<li class="list-item">${c.name}</li>`).join("")
      : "<li>No classes.</li>";
  } catch (e) {
    console.error("loadClassList error:", e);
    el.innerHTML = "<li>Error loading classes</li>";
  }
}

async function loadSectionList() {
  const el = safeGet("sectionList");
  if (!el) return;
  try {
    const list = await window.dbAPI.getAllSections();
    el.innerHTML = Array.isArray(list) && list.length
      ? list.map((s) => `<li class="list-item">${s.name}</li>`).join("")
      : "<li>No sections.</li>";
  } catch (e) {
    console.error("loadSectionList error:", e);
    el.innerHTML = "<li>Error loading sections</li>";
  }
}

/* =====================================================
   CHILD REGISTRATION
===================================================== */
function renderChild(content) {
  content.innerHTML = `
    <h3>Register Child</h3>
    <div class="form-group">
      <label>Child Name</label>
      <input id="childName" placeholder="name"/>
    </div>
    <div class="form-group">
      <label>Class</label>
      <select id="childClass"></select>
    </div>
    <div class="form-group">
      <label>Section</label>
      <select id="childSection"></select>
    </div>
    <button id="addChildBtn" class="primary">Add Child</button>
    <hr/>
    <ul id="childList"></ul>
  `;
  safeGet("addChildBtn")?.addEventListener("click", addChild);
  loadClassSectionOptions("childClass", "childSection");
  loadChildren();
}

async function addChild() {
  const nameEl = safeGet("childName");
  const classEl = safeGet("childClass");
  const secEl = safeGet("childSection");
  if (!nameEl || !classEl || !secEl) return;
  const name = nameEl.value.trim().toLowerCase();
  const cls = classEl.value.trim().toLowerCase();
  const sec = secEl.value.trim().toLowerCase();
  if (!name || !cls || !sec) return alert("Fill all fields");
  try {
    await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
    nameEl.value = "";
    loadChildren();
  } catch (e) {
    console.error("addChild error:", e);
    alert("Failed to add child");
  }
}

async function loadChildren() {
  const el = safeGet("childList");
  if (!el) return;
  try {
    const kids = await window.dbAPI.getAllChildren();
    el.innerHTML = Array.isArray(kids) && kids.length
      ? kids.map((c) => `<li class="list-item">${c.name} (${c.class}-${c.section})</li>`).join("")
      : "<li>No children registered.</li>";
  } catch (e) {
    console.error("loadChildren error:", e);
    el.innerHTML = "<li>Error loading children</li>";
  }
}

async function loadClassSectionOptions(classId, sectionId) {
  const classEl = safeGet(classId);
  const sectionEl = safeGet(sectionId);
  if (!classEl || !sectionEl) return;
  try {
    const cs = await window.dbAPI.getAllClasses();
    const ss = await window.dbAPI.getAllSections();
    classEl.innerHTML = Array.isArray(cs) && cs.length ? cs.map((c) => `<option>${c.name}</option>`).join("") : "<option></option>";
    sectionEl.innerHTML = Array.isArray(ss) && ss.length ? ss.map((s) => `<option>${s.name}</option>`).join("") : "<option></option>";
  } catch (e) {
    console.error("loadClassSectionOptions error:", e);
  }
}

/* =====================================================
   LINK MODE (Parent -> Class -> Section -> Child)
===================================================== */
function renderLinkMode(content) {
  content.innerHTML = `
    <h3>Link Parents & Children</h3>
    <div class="form-group">
      <label>Parent (type first 3 letters)</label>
      <input id="parentSearch" placeholder="type parent name..." />
      <select id="parentSelect" size="4" style="width:100%"></select>
    </div>
    <div class="form-group">
      <label>Select Class</label>
      <select id="linkClass"><option value="">-- select class --</option></select>
    </div>
    <div class="form-group">
      <label>Select Section</label>
      <select id="linkSection"><option value="">-- select section --</option></select>
    </div>
    <div class="form-group">
      <label>Child (type first 3 letters)</label>
      <input id="childSearch" placeholder="type child name..." disabled />
      <select id="childrenSelect" multiple size="6" style="width:100%"></select>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button id="linkBtn" class="primary">Link Selected Children</button>
      <div id="linkHint" style="color:#f59e0b;margin-left:6px;"></div>
    </div>
    <hr/>
    <h4>Existing Links</h4>
    <ul id="linkList"></ul>
  `;
  // populate class/section selects and then bind handlers
  loadClassSectionOptions("linkClass", "linkSection").then(() => setupLinkHandlers());
  loadLinks();
}

function setupLinkHandlers() {
  const parentSearch = safeGet("parentSearch");
  const parentSelect = safeGet("parentSelect");
  const classSelect = safeGet("linkClass");
  const sectionSelect = safeGet("linkSection");
  const childSearch = safeGet("childSearch");
  const childrenSelect = safeGet("childrenSelect");
  const linkHint = safeGet("linkHint");
  const linkBtn = safeGet("linkBtn");

  function updateChildSearchState() {
    const parentChosen = parentSelect && parentSelect.value;
    const clsChosen = classSelect && classSelect.value;
    const secChosen = sectionSelect && sectionSelect.value;
    const enabled = parentChosen && clsChosen && secChosen;
    if (childSearch) childSearch.disabled = !enabled;
    if (linkHint) linkHint.textContent = enabled ? "" : "Select parent, class & section first";
    if (!enabled && childrenSelect) childrenSelect.innerHTML = "";
  }

  parentSearch.oninput = async () => {
    const term = parentSearch.value.trim().toLowerCase();
    parentSelect.innerHTML = "";
    if (term.length >= 3) {
      try {
        const parents = await window.dbAPI.getAllUsers();
        const matches = (parents || []).filter((p) => p.name && p.name.startsWith(term));
        if (!matches.length) parentSelect.innerHTML = `<option disabled>No matches</option>`;
        else {
          matches.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.role})`;
            parentSelect.appendChild(opt);
          });
        }
      } catch (e) {
        console.error("parentSearch error:", e);
      }
    }
    updateChildSearchState();
  };

  [parentSelect, classSelect, sectionSelect].forEach((el) => el?.addEventListener("change", updateChildSearchState));

  childSearch.oninput = async () => {
    childrenSelect.innerHTML = "";
    const term = childSearch.value.trim().toLowerCase();
    const cls = (classSelect.value || "").trim().toLowerCase();
    const sec = (sectionSelect.value || "").trim().toLowerCase();
    if (term.length >= 3) {
      try {
        const all = await window.dbAPI.getAllChildren();
        const matches = (all || []).filter((c) => {
          const nameMatches = c.name && c.name.startsWith(term);
          const classMatches = cls ? (c.class && c.class.toLowerCase() === cls) : true;
          const secMatches = sec ? (c.section && c.section.toLowerCase() === sec) : true;
          return nameMatches && classMatches && secMatches;
        });
        if (!matches.length) childrenSelect.innerHTML = `<option disabled>No children found</option>`;
        else {
          matches.forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = `${c.name} (${c.class}-${c.section})`;
            childrenSelect.appendChild(opt);
          });
        }
      } catch (e) {
        console.error("childSearch error:", e);
      }
    }
  };

  linkBtn.onclick = async () => {
    const parentId = parentSelect.value;
    const selected = Array.from((childrenSelect.selectedOptions || [])).map(o => o.value);
    if (!parentId) return alert("Select a parent first.");
    if (!classSelect.value || !sectionSelect.value) return alert("Select class & section.");
    if (!selected.length) return alert("Select at least one child to link.");
    try {
      await window.dbAPI.linkParentChildren(parentId, selected);
      alert("Linked successfully!");
      childSearch.value = "";
      childrenSelect.innerHTML = "";
      loadLinks();
    } catch (e) {
      console.error("linkParentChildren error:", e);
      alert("Failed to link.");
    }
  };
}

async function loadLinks() {
  const el = safeGet("linkList");
  if (!el) return;
  try {
    const links = await window.dbAPI.getAllLinks();
    const parents = await window.dbAPI.getAllUsers();
    const children = await window.dbAPI.getAllChildren();
    el.innerHTML = Array.isArray(links) && links.length
      ? links.map((l) => {
          const p = (parents || []).find(pr => pr.id === l.parentId);
          const kids = (l.childrenIds || []).map(cid => {
            const c = (children || []).find(ch => ch.id === cid);
            return c ? `${c.name} (${c.class}-${c.section})` : "";
          }).filter(Boolean).join(", ");
          return `<li class="list-item"><strong>${p ? p.name : "(unknown)"}</strong> → ${kids}</li>`;
        }).join("")
      : "<li>No links found.</li>";
  } catch (e) {
    console.error("loadLinks error:", e);
    el.innerHTML = "<li>Error loading links</li>";
  }
}

/* =====================================================
   RECOGNITION MODE
===================================================== */
function renderRecognition(content) {
  content.innerHTML = `
    <h3>Recognition</h3>
    <div id="recognitionResult" class="result-box"></div>
  `;
  // try prefer back camera for recognition when available
  const back = videoDevices.find((d) => /back|rear|environment/i.test((d.label || "").toLowerCase()));
  if (back) {
    // attempt to switch to back camera; ignore failure
    switchCamera(back.deviceId, true).catch(() => {});
  }
  startRecognition();
}

async function startRecognition() {
  // Clear any previous recognition interval
  if (recognitionInterval) { clearInterval(recognitionInterval); recognitionInterval = null; }

  // load descriptors from DB
  const users = await window.dbAPI.getAllUsers();
  const links = await window.dbAPI.getAllLinks();
  const children = await window.dbAPI.getAllChildren();
  if (!Array.isArray(users) || users.length === 0) {
    setStatus("No registered parents");
    safeGet("recognitionResult").innerHTML = "<p>No registered parents</p>";
    return;
  }

  // Build labeled descriptors
  const labeled = users.map(u => {
    // u.descriptor stored as array
    const desc = new Float32Array(u.descriptor || []);
    return new faceapi.LabeledFaceDescriptors(u.name, [desc]);
  });

  const matcher = new faceapi.FaceMatcher(labeled, 0.6);
  const v = safeGet("video");
  const o = safeGet("overlay");
  const resultBox = safeGet("recognitionResult");
  if (!v || !o || !resultBox) return;

  recognitionInterval = setInterval(async () => {
    try {
      if (!modelsLoaded || !v.videoWidth) return;
      // ensure overlay matches
      matchOverlayToVideo(v);

      const detection = await faceapi
        .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.32 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      const ctx = o.getContext("2d");
      ctx.clearRect(0, 0, o.width, o.height);
      resultBox.innerHTML = "";

      if (!detection) {
        setStatus("No face detected");
        return;
      }

      // Draw aligned detection
      drawAlignedDetections(v, o, [detection]);

      // Match
      const best = matcher.findBestMatch(detection.descriptor);
      if (best.label === "unknown") {
        resultBox.innerHTML = `<p style="color:red;font-weight:600;">❌ Unrecognized</p>`;
        return;
      }

      // find parent record, links, children
      const parent = (users || []).find(u => u.name === best.label);
      const link = (links || []).find(l => l.parentId === parent?.id);
      const kidsHtml = (link?.childrenIds || []).map(cid => {
        const c = (children || []).find(ch => ch.id === cid);
        return c ? `<li>${c.name} (${c.class}-${c.section})</li>` : "";
      }).join("");

      resultBox.innerHTML = `
        <p style="color:green;font-weight:700;">✅ Recognized: ${best.label}</p>
        ${ kidsHtml ? `<p><strong>Linked Children:</strong></p><ul>${kidsHtml}</ul>` : "<p>No linked children</p>" }
      `;
    } catch (e) {
      console.error("recognition loop error:", e);
    }
  }, 350);
}

/* =====================================================
   CLEANUP ON UNLOAD
===================================================== */
window.addEventListener("beforeunload", () => {
  try {
    if (currentStream) currentStream.getTracks().forEach(t => t.stop());
  } catch (e) {}
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
});
