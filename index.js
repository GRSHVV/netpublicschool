/* ============================================================
   index.js — Smart Pickup System (Full, working, face recognition)
   - Requirements:
     * index.html with expected DOM IDs
     * db.js exposing window.dbAPI (with openDB, addUser, getAllUsers, addLink, getAllChildren, addAudit, addChild, addClassEntry, getAllClasses, addSectionEntry, getAllSections, getAllLinks, getLastAudits)
     * face-api.min.js loaded before this script
     * ./models folder present (used by faceapi.loadFromUri)
   ============================================================ */

"use strict";

/* ---------------------------
   Global state
   --------------------------- */
let videoEl, overlayEl, overlayCtx;
let modelsLoaded = false;
let detectionIntervalId = null;
let recognitionMatcher = null; // faceapi.FaceMatcher
let labeledDescriptorsCache = []; // [{ label, descriptors: [Float32Array,...] }]
let lastDetection = null; // latest detection object with descriptor
let allVideoDevices = [];
let currentCameraId = null;
let isDetecting = false;

/* ---------------------------
   Small utilities
   --------------------------- */
const $ = (id) => document.getElementById(id);
function setStatus(msg) {
  const el = $("statusMsg");
  if (el) el.textContent = msg;
  console.log("[status]", msg);
}
function safeSetHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------------------
   Audio beep helpers
   --------------------------- */
function playBeep(durationMs = 120, freq = 1000, type = "sine") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.value = 0.001;
    o.start();
    // ramp up a bit for click-free sound
    g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    setTimeout(() => {
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
      setTimeout(() => { o.stop(); ctx.close(); }, 60);
    }, durationMs);
  } catch (e) {
    console.warn("AudioContext not available:", e);
  }
}

/* ---------------------------
   Model loading
   --------------------------- */
async function loadFaceModels() {
  try {
    setStatus("Loading face models...");
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    ]);
    modelsLoaded = true;
    setStatus("Models loaded.");
    console.log("face models loaded");
  } catch (err) {
    console.error("Failed to load models:", err);
    alert("Failed to load face models. Check ./models folder and console for 404s.");
  }
}

/* ---------------------------
   Camera enumeration and switching
   --------------------------- */
async function enumerateCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    allVideoDevices = devices.filter((d) => d.kind === "videoinput");
    const sel = $("cameraSelect");
    if (!sel) return;
    sel.innerHTML = "";
    if (allVideoDevices.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No camera found";
      opt.disabled = true;
      sel.appendChild(opt);
      setStatus("No camera found");
      return;
    }
    allVideoDevices.forEach((dev, idx) => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      // Label is often empty until permission granted; show friendly text
      opt.textContent = dev.label || (idx === 0 ? "Default camera" : `Camera ${idx+1}`);
      sel.appendChild(opt);
    });
    // handle change
    sel.onchange = async (e) => {
      const id = e.target.value;
      await startCamera(id);
    };
    // set default if not set
    if (!currentCameraId && allVideoDevices.length > 0) {
      currentCameraId = allVideoDevices[0].deviceId;
      sel.value = currentCameraId;
    } else if (currentCameraId) {
      sel.value = currentCameraId;
    }
  } catch (err) {
    console.error("enumerateCameras error", err);
  }
}

async function startCamera(deviceId = null) {
  try {
    // stop old stream
    if (videoEl && videoEl.srcObject) {
      videoEl.srcObject.getTracks().forEach((t) => t.stop());
      videoEl.srcObject = null;
    }

    // request permission via small request to prompt on some mobile browsers
    try {
      // if user hasn't granted yet, this triggers the prompt
      await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (e) {
      // ignore — we'll request below with specific constraints
    }

    // re-enumerate (label availability can change after permission)
    await enumerateCameras();

    let constraints;
    // On mobile, using exact deviceId sometimes fails; use ideal first
    if (deviceId) {
      currentCameraId = deviceId;
      constraints = {
        audio: false,
        video: {
          deviceId: { ideal: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
    } else {
      // prefer environment (back camera) by default on mobile
      constraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
    }

    setStatus("Starting camera...");
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = stream;
    await videoEl.play();

    // resize overlay to match video display size (use css rendered size)
    await syncOverlaySize();

    setStatus("Camera active.");
    // repopulate select labels now that permission is granted
    await enumerateCameras();

    // run detection loop if models ready
    if (modelsLoaded && !isDetecting) {
      startDetectionLoop();
    }
  } catch (err) {
    console.error("startCamera error", err);
    let msg = "Camera error";
    if (err.name === "NotAllowedError") msg = "Camera permission denied. Allow access in site settings.";
    else if (err.name === "NotFoundError") msg = "No camera found.";
    else if (err.name === "NotReadableError") msg = "Camera is busy.";
    else if (err.name === "OverconstrainedError") msg = "Requested camera not available.";
    setStatus(msg);
    alert(msg);
  }
}

function syncOverlaySize() {
  return new Promise((resolve) => {
    // compute displayed video size (css size)
    // we want overlay canvas to match the displayed video element pixel size
    requestAnimationFrame(() => {
      const rect = videoEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      overlayEl.style.width = rect.width + "px";
      overlayEl.style.height = rect.height + "px";
      overlayEl.width = Math.round(rect.width * dpr);
      overlayEl.height = Math.round(rect.height * dpr);
      overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale drawing for dpr
      resolve();
    });
  });
}

/* ---------------------------
   Face detection + recognition
   --------------------------- */
async function buildMatcherFromDB() {
  try {
    const users = await window.dbAPI.getAllUsers();
    // Each user in DB is expected to have descriptor stored as Array (numbers)
    const labeled = [];
    for (const u of users) {
      if (!u.descriptor || !Array.isArray(u.descriptor) || u.descriptor.length === 0) continue;
      const fd = new Float32Array(u.descriptor);
      labeled.push(new faceapi.LabeledFaceDescriptors(u.name, [fd]));
    }
    if (labeled.length === 0) {
      recognitionMatcher = null;
      return;
    }
    recognitionMatcher = new faceapi.FaceMatcher(labeled, 0.55); // threshold adjustable
    console.log("Matcher built with", labeled.length, "labels");
  } catch (err) {
    console.error("buildMatcherFromDB", err);
  }
}

function clearOverlay() {
  if (!overlayCtx) return;
  overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
}

function drawBox(box, labelText, color = "lime") {
  if (!overlayCtx) return;
  overlayCtx.strokeStyle = color;
  overlayCtx.lineWidth = 3;
  overlayCtx.strokeRect(box.x, box.y, box.width, box.height);
  if (labelText) {
    overlayCtx.fillStyle = color;
    overlayCtx.font = "16px sans-serif";
    overlayCtx.fillText(labelText, box.x + 4, box.y - 6);
  }
}

/* Detection loop: if in recognition mode or registration mode, detect */
function startDetectionLoop() {
  if (isDetecting) return;
  isDetecting = true;
  // Use tiny face detector small input for speed
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

  detectionIntervalId = setInterval(async () => {
    try {
      if (!modelsLoaded || !videoEl || videoEl.readyState < 2) return;
      // detect single face for speed
      const detection = await faceapi
        .detectSingleFace(videoEl, options)
        .withFaceLandmarks()
        .withFaceDescriptor();
      await syncOverlaySize();
      clearOverlay();
      if (!detection) {
        lastDetection = null;
        // disable register button when no face present
        const regBtn = $("registerBtn");
        if (regBtn) regBtn.disabled = true;
        // also show recognition waiting
        if (currentMode === "recognition") {
          safeSetHTML("recognitionResult", `<div style="opacity:0.7">No face detected</div>`);
        }
        return;
      }

      lastDetection = detection; // keep descriptor for registration

      // compute bounding box in overlay coordinates
      const box = detection.detection.box;
      // faceapi's box is in video intrinsic coordinate space; we need scaling factor.
      // We set overlay canvas CSS size equal to video bounding rect, and overlay ctx scaled by devicePixelRatio.
      // So we can draw directly using box.x/y/width/height scaled by ratio of displayed video width / video.videoWidth
      const videoRect = videoEl.getBoundingClientRect();
      const scaleX = videoRect.width / videoEl.videoWidth;
      const scaleY = videoRect.height / videoEl.videoHeight;
      const isMirrored = window.getComputedStyle(videoEl).transform.includes("scaleX(-1)") || getComputedStyle(videoEl).transform === "matrix(-1, 0, 0, 1, 0, 0)";

      // compute drawn coordinates on overlay (CSS pixels)
      let drawX = box.x * scaleX;
      let drawY = box.y * scaleY;
      let drawW = box.width * scaleX;
      let drawH = box.height * scaleY;

      // if video is mirrored horizontally (front camera), flip X
      if (isMirrored) {
        drawX = videoRect.width - drawX - drawW;
      }

      // Transform CSS coordinates into canvas coordinate system already scaled by devicePixelRatio via ctx.setTransform
      // Because we scaled ctx by dpr, we can draw in CSS pixels directly.

      // Recognition: try to match descriptor
      let label = "unknown";
      if (recognitionMatcher) {
        const best = recognitionMatcher.findBestMatch(detection.descriptor);
        label = best.label;
      }

      const color = label === "unknown" ? "red" : "lime";
      drawBox({ x: drawX, y: drawY, width: drawW, height: drawH }, label, color);

      // enable register button in registration mode
      const regBtn = $("registerBtn");
      if (regBtn) regBtn.disabled = false;

      // In recognition mode show children list and play beep for newly recognized
      if (currentMode === "recognition") {
        if (label === "unknown") {
          safeSetHTML("recognitionResult", `<div style="color:#b91c1c">Unrecognized face</div>`);
          playBeep(400, 220, "sine"); // long beep for unknown
        } else {
          // recognized: show linked children (from DB)
          const users = await window.dbAPI.getAllUsers();
          const parent = users.find((u) => u.name === label);
          if (!parent) {
            safeSetHTML("recognitionResult", `<div>Recognized: ${label} (no DB record)</div>`);
            playBeep(120, 1200, "sine");
          } else {
            // find links for parent
            const links = await window.dbAPI.getAllLinks();
            const linkRec = links.filter((l) => l.parentId === parent.id);
            // links may store 'childrenIds' or 'childId' depending on implementation; support both
            let childrenIds = [];
            if (linkRec.length === 0) {
              childrenIds = [];
            } else {
              // if links are stored one per parent with childrenIds array
              const lr = linkRec[0];
              if (Array.isArray(lr.childrenIds)) childrenIds = lr.childrenIds;
              else {
                // or links are many rows with childId field
                childrenIds = linkRec.map((r) => (r.childId ? r.childId : (r.childrenIds ? r.childrenIds[0] : null))).filter(Boolean);
              }
            }
            // fetch children details
            const allChildren = await window.dbAPI.getAllChildren();
            const linkedChildren = allChildren.filter((c) => childrenIds.includes(c.id));
            const kidsHtml = linkedChildren.length
              ? `<ul>${linkedChildren.map((c) => `<li>${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})</li>`).join("")}</ul>`
              : "<div>No linked children</div>";

            safeSetHTML("recognitionResult", `<div><strong>Recognized:</strong> ${escapeHtml(parent.name)} ${kidsHtml}
              <div style="margin-top:8px"><button id="auditBtn">Create Audit</button></div></div>`);
            playBeep(120, 1200, "square");
            // Wire audit button
            const auditBtn = $("auditBtn");
            if (auditBtn) {
              auditBtn.onclick = async () => {
                if (linkedChildren.length === 0) return alert("No child linked.");
                for (const ch of linkedChildren) {
                  const rec = { id: Date.now().toString() + Math.random(), parentId: parent.id, childId: ch.id, timestamp: Date.now() };
                  await window.dbAPI.addAudit(rec);
                }
                // show last audits marquee top of bottom panel
                await refreshLastAudits();
                alert("Audit records created for linked children.");
              };
            }
          }
        }
      }

    } catch (err) {
      console.error("detection loop error:", err);
    }
  }, 600); // each 600ms
}

/* small HTML-escape for safety */
function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

/* ---------------------------
   Registration: register parent with lastDetection descriptor
   --------------------------- */
async function registerParentHandler() {
  try {
    const nameEl = $("username");
    const roleEl = $("role");
    if (!nameEl || !roleEl) return alert("Form elements missing");

    const name = nameEl.value.trim().toLowerCase();
    const role = roleEl.value.trim().toLowerCase();
    if (!name) return alert("Enter parent name");

    if (!lastDetection || !lastDetection.descriptor) {
      return alert("No face currently detected. Please position the parent's face to camera.");
    }

    // Convert descriptor Float32Array to regular Array for storage
    const descriptorArray = Array.from(lastDetection.descriptor);

    await window.dbAPI.addUser({
      id: Date.now().toString(),
      name,
      role,
      descriptor: descriptorArray,
    });

    setStatus("Parent registered: " + name);
    await buildMatcherFromDB();
    await updateStats();
    playBeep(120, 1400, "sine");
    alert("Parent registered successfully");
  } catch (err) {
    console.error("registerParentHandler", err);
    alert("Failed to register parent: see console");
  }
}

/* ---------------------------
   Build matcher and refresh caches
   --------------------------- */
async function refreshRecognitionModel() {
  await buildMatcherFromDB();
}

/* ---------------------------
   Admin pages and UI wiring
   --------------------------- */

function wireMenuButtons() {
  const btnAdmin = $("btnAdmin");
  if (btnAdmin) btnAdmin.onclick = () => loadRegisterParentUI();

  const btnChild = $("btnChild");
  if (btnChild) btnChild.onclick = () => loadRegisterChildUI();

  const btnClass = $("btnClass");
  if (btnClass) btnClass.onclick = () => loadManageClassesUI();

  const btnLink = $("btnLink");
  if (btnLink) btnLink.onclick = () => loadLinkUI();

  const btnRec = $("btnRecognition");
  if (btnRec) btnRec.onclick = () => loadRecognitionUI();

  const refreshBtn = $("refreshStatsBtn");
  if (refreshBtn) refreshBtn.onclick = async () => {
    refreshBtn.style.transform = "rotate(360deg)";
    await updateStats();
    setTimeout(()=> refreshBtn.style.transform = "", 400);
  };
}

async function loadRegisterParentUI() {
  currentMode = "register";
  safeSetHTML("modeContent", `
    <h3>Register Parent</h3>
    <label>Parent Name</label>
    <input id="username" placeholder="name" />
    <label>Role</label>
    <select id="role"><option>father</option><option>mother</option><option>guardian</option></select>
    <div style="margin-top:8px;"><button id="registerBtn" disabled>Register</button></div>
    <p style="font-size:0.9rem;color:#666;margin-top:8px">Face must be visible for Register to enable.</p>
  `);

  // register button handler
  const reg = $("registerBtn");
  if (reg) {
    reg.onclick = registerParentHandler;
    // It starts disabled; detection loop will enable when face is present
  }

  // make sure camera is running
  await startCamera(currentCameraId);
}

async function loadRegisterChildUI() {
  currentMode = "childRegister";
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  safeSetHTML("modeContent", `
    <h3>Register Child</h3>
    <label>Child Name</label><input id="childName" placeholder="child name" />
    <label>Class</label><select id="childClass">${classes.map(c=>`<option value="${escapeHtml(c.className)}">${escapeHtml(c.className)}</option>`).join("")}</select>
    <label>Section</label><select id="childSection">${sections.map(s=>`<option value="${escapeHtml(s.sectionName)}">${escapeHtml(s.sectionName)}</option>`).join("")}</select>
    <div style="margin-top:8px"><button id="addChildBtn">Add Child</button></div>
  `);
  $("addChildBtn").onclick = async () => {
    const nm = $("childName").value.trim().toLowerCase();
    const cls = $("childClass").value.trim().toLowerCase();
    const sec = $("childSection").value.trim().toLowerCase();
    if (!nm || !cls || !sec) return alert("Fill all fields");
    await window.dbAPI.addChild({ id: Date.now().toString(), name: nm, class: cls, section: sec });
    alert("Child added");
    $("childName").value = "";
    await updateStats();
  };
}

async function loadManageClassesUI() {
  currentMode = "classes";
  safeSetHTML("modeContent", `
    <h3>Classes & Sections</h3>
    <div style="display:flex;gap:12px;">
      <div style="flex:1;">
        <label>Class name</label><input id="className" placeholder="e.g. Grade 8" />
        <div style="margin-top:8px"><button id="addClassBtn">Add Class</button></div>
        <h4>Existing Classes</h4><ul id="classList"></ul>
      </div>
      <div style="flex:1;">
        <label>Section name</label><input id="sectionName" placeholder="e.g. A" />
        <div style="margin-top:8px"><button id="addSectionBtn">Add Section</button></div>
        <h4>Existing Sections</h4><ul id="sectionList"></ul>
      </div>
    </div>
  `);
  $("addClassBtn").onclick = async () => {
    const val = $("className").value.trim().toLowerCase();
    if (!val) return alert("Enter class name");
    await window.dbAPI.addClassEntry({ id: Date.now().toString(), className: val });
    $("className").value = "";
    await refreshClassSectionListsUI();
  };
  $("addSectionBtn").onclick = async () => {
    const val = $("sectionName").value.trim().toLowerCase();
    if (!val) return alert("Enter section name");
    await window.dbAPI.addSectionEntry({ id: Date.now().toString(), sectionName: val });
    $("sectionName").value = "";
    await refreshClassSectionListsUI();
  };
  await refreshClassSectionListsUI();
}

async function refreshClassSectionListsUI() {
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  const classList = $("classList");
  const sectionList = $("sectionList");
  if (classList) classList.innerHTML = classes.map(c => `<li>${escapeHtml(c.className)} <button data-id="${c.id}" class="del-class">Delete</button></li>`).join("");
  if (sectionList) sectionList.innerHTML = sections.map(s => `<li>${escapeHtml(s.sectionName)} <button data-id="${s.id}" class="del-section">Delete</button></li>`).join("");

  // wire delete buttons
  document.querySelectorAll(".del-class").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Delete class?")) return;
      const id = btn.dataset.id;
      const db = await window.dbAPI.openDB();
      const tx = db.transaction("classes","readwrite");
      tx.objectStore("classes").delete(id);
      tx.oncomplete = refreshClassSectionListsUI;
    };
  });
  document.querySelectorAll(".del-section").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Delete section?")) return;
      const id = btn.dataset.id;
      const db = await window.dbAPI.openDB();
      const tx = db.transaction("sections","readwrite");
      tx.objectStore("sections").delete(id);
      tx.oncomplete = refreshClassSectionListsUI;
    };
  });
}

async function loadLinkUI() {
  currentMode = "link";
  const parents = await window.dbAPI.getAllUsers();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  safeSetHTML("modeContent", `
    <h3>Link Parent & Child</h3>
    <label>Parent (type first 3 letters)</label><input id="parentSearch" placeholder="start typing..." />
    <select id="parentMatches" size="4" style="width:100%"></select>
    <label>Class</label><select id="linkClass">${classes.map(c=>`<option>${escapeHtml(c.className)}</option>`).join("")}</select>
    <label>Section</label><select id="linkSection">${sections.map(s=>`<option>${escapeHtml(s.sectionName)}</option>`).join("")}</select>
    <label>Child (type first 3 letters)</label><input id="childSearch" placeholder="start typing..." disabled />
    <select id="childMatches" multiple size="6" style="width:100%"></select>
    <div style="margin-top:8px"><button id="linkBtn">Link Selected</button></div>
    <h4>Existing Links</h4><ul id="linksList"></ul>
  `);

  const pSearch = $("parentSearch");
  const pMatches = $("parentMatches");
  const cSearch = $("childSearch");
  const childMatches = $("childMatches");
  const lClass = $("linkClass");
  const lSection = $("linkSection");
  pSearch.oninput = async () => {
    const term = pSearch.value.trim().toLowerCase();
    pMatches.innerHTML = "";
    if (term.length >= 3) {
      const users = await window.dbAPI.getAllUsers();
      const hits = users.filter(u => u.name.startsWith(term));
      pMatches.innerHTML = hits.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join("");
    }
    cSearch.disabled = !pMatches.value;
  };
  cSearch.oninput = async () => {
    const term = cSearch.value.trim().toLowerCase();
    childMatches.innerHTML = "";
    if (term.length >= 3) {
      const allChildren = await window.dbAPI.getAllChildren();
      const cls = lClass.value.toLowerCase();
      const sec = lSection.value.toLowerCase();
      const hits = allChildren.filter(ch => ch.name.startsWith(term) && ch.class.toLowerCase() === cls && ch.section.toLowerCase() === sec);
      childMatches.innerHTML = hits.map(c=>`<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})</option>`).join("");
    }
  };
  $("linkBtn").onclick = async () => {
    const parentId = pMatches.value;
    const childIds = Array.from(childMatches.selectedOptions).map(o => o.value);
    if (!parentId || childIds.length === 0) return alert("Select parent and children");
    // store link: try to preserve many-to-many. check if link store uses single objects with parentId->childrenIds or multiple rows
    // We'll create a single link object per parent for simplicity
    const links = await window.dbAPI.getAllLinks();
    let existing = links.find(l=>l.parentId===parentId);
    if (!existing) {
      await window.dbAPI.addLink({ id: Date.now().toString()+Math.random(), parentId, childrenIds: childIds });
    } else {
      // merge distinct
      const merged = Array.from(new Set([...(existing.childrenIds||[]), ...childIds]));
      // delete old and add new or update — we don't have update API, so add new and delete old
      const db = await window.dbAPI.openDB();
      const tx = db.transaction("links","readwrite");
      tx.objectStore("links").delete(existing.id);
      tx.oncomplete = async () => {
        await window.dbAPI.addLink({ id: Date.now().toString()+Math.random(), parentId, childrenIds: merged });
        await refreshLinksList();
        alert("Linked updated");
      };
      return;
    }
    await refreshLinksList();
    alert("Linked added");
  };

  await refreshLinksList();
}

async function refreshLinksList() {
  const links = await window.dbAPI.getAllLinks();
  const users = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const listEl = $("linksList");
  if (!listEl) return;
  if (!links || links.length === 0) {
    listEl.innerHTML = "<li>No links</li>";
    return;
  }
  listEl.innerHTML = links.map(l=>{
    const p = users.find(u=>u.id===l.parentId);
    const kids = (l.childrenIds||[]).map(cid => children.find(c=>c.id===cid)).filter(Boolean).map(c=>`${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})`).join(", ");
    return `<li>${p?escapeHtml(p.name):"(unknown)"} → ${kids}</li>`;
  }).join("");
}

/* Recognition UI */
async function loadRecognitionUI() {
  currentMode = "recognition";
  safeSetHTML("modeContent", `
    <h3>Recognition</h3>
    <div id="recognitionResult" style="min-height:120px">Waiting for face...</div>
    <div style="margin-top:8px"><small>Show a registered parent's face to identify and process pickup.</small></div>
  `);
  await startCamera(currentCameraId);
}

/* ---------------------------
   Audits display (marquee-like last 10)
   --------------------------- */
async function refreshLastAudits() {
  const last = await window.dbAPI.getLastAudits(10);
  const box = $("recognitionResult");
  if (!box) return;
  if (!last || last.length === 0) return;
  // We will show simple list
  const users = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const html = `<div><strong>Recent audits</strong><ul>${last.map(a=>{
    const p = users.find(u=>u.id===a.parentId);
    const c = children.find(ch=>ch.id===a.childId);
    const t = new Date(a.timestamp).toLocaleString();
    return `<li>${p?escapeHtml(p.name):"?"} picked up ${c?escapeHtml(c.name):"?"} @ ${t}</li>`;
  }).join("")}</ul></div>`;
  // append to bottomPanel recognition area rather than replacing
  safeSetHTML("recognitionResult", html);
}

/* ---------------------------
   Build recognition matcher from DB
   --------------------------- */
async function buildMatcherFromDB() {
  try {
    const users = await window.dbAPI.getAllUsers();
    const labeled = [];
    for (const u of users) {
      if (u.descriptor && Array.isArray(u.descriptor) && u.descriptor.length === 128) {
        labeled.push(new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)]));
      }
    }
    recognitionMatcher = labeled.length ? new faceapi.FaceMatcher(labeled, 0.55) : null;
    console.log("Recognition matcher ready:", labeled.length, "labels");
  } catch (err) {
    console.error("buildMatcherFromDB error", err);
  }
}

/* ---------------------------
   Stats (parents / children)
   --------------------------- */
async function updateStats() {
  try {
    const parents = await window.dbAPI.getAllUsers();
    const children = await window.dbAPI.getAllChildren();
    if ($("parentCount")) $("parentCount").textContent = parents.length;
    if ($("childCount")) $("childCount").textContent = children.length;
  } catch (err) {
    console.warn("updateStats err", err);
  }
}

/* ---------------------------
   Setup on load
   --------------------------- */
async function appInit() {
  // elements
  videoEl = $("video");
  overlayEl = $("overlay");
  overlayCtx = overlayEl.getContext("2d");

  // ensure db is ready
  if (window.dbAPI && typeof window.dbAPI.openDB === "function") {
    await window.dbAPI.openDB();
  } else {
    console.warn("dbAPI.openDB not available yet — continuing");
  }

  wireUI();
  await loadFaceModels();
  await enumerateCameras(); // fills cameraSelect
  await buildMatcherFromDB();
  await updateStats();

  // start camera only when user chooses recognition or registration; to be safe, start default camera
  // but on some tablets browsers require a user gesture; we try to start and errors will be shown
  try {
    await startCamera(currentCameraId);
  } catch (e) {
    console.warn("startCamera on init failed (OK):", e);
  }
}

/* Wire UI menu buttons & initial display */
function wireUI() {
  wireMenuButtons();
  // default to admin registration UI
  loadRegisterParentUI();
}

/* Wire low-level menu used previously (keeps compatibility) */
function wireMenuButtons() {
  // map of known button ids to functions
  const map = {
    btnAdmin: loadRegisterParentUI,
    btnChild: loadRegisterChildUI,
    btnClass: loadManageClassesUI,
    btnLink: loadLinkUI,
    btnRecognition: loadRecognitionUI
  };
  for (const id in map) {
    const el = $(id);
    if (el) el.onclick = map[id];
  }
  const refreshBtn = $("refreshStatsBtn");
  if (refreshBtn) refreshBtn.onclick = async () => { refreshBtn.style.transform="rotate(360deg)"; await updateStats(); setTimeout(()=>refreshBtn.style.transform="",400); };
}

/* ---------------------------
   Helpers: small wrappers for html updates used earlier
   --------------------------- */
function safeSetHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

/* ---------------------------
   Start app
   --------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  appInit().catch(err => console.error("appInit failed", err));
});

/* ---------------------------
   Expose some internals for debugging in console
   --------------------------- */
window._pickupDebug = {
  startCamera,
  enumerateCameras,
  buildMatcherFromDB,
  startDetectionLoop,
  stopDetection: () => { if (detectionIntervalId) clearInterval(detectionIntervalId); isDetecting=false; },
  playBeep
};
