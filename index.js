/* ============================================================
  Full index.js — Final (fixes audit display + continuous flow)
  - Requirements:
    * `face-api.min.js` loaded before this file
    * `./models` folder served
    * `db.js` exposing window.dbAPI with expected methods (openDB/addUser/getAllUsers/addChild/getAllChildren/addClassEntry/getAllClasses/addSectionEntry/getAllSections/addLink/getAllLinks/addAudit/getLastAudits/getAllAudits) — code will try fallbacks
    * index.html includes elements with IDs used below
  ============================================================ */

"use strict";

/* -----------------------
   Globals
   ----------------------- */
let video, overlay, ctx;
let modelsLoaded = false;
let detectionInterval = null;
let currentMode = "none"; // "registerParent","registerChild","classManager","link","recognition"
let recognitionMatcher = null;
let lastDetection = null;
let tempNoPickup = false; // temporary no-pickup after marking
let recognitionPaused = false; // pause detection while operator marks pickup

/* -----------------------
   DOM helpers
   ----------------------- */
const $ = (id) => document.getElementById(id);
const log = (...args) => console.log("[APP]", ...args);
function setStatus(msg) { const e = $("statusMsg"); if (e) e.textContent = msg; }

/* -----------------------
   Audio helper
   ----------------------- */
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
    g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    setTimeout(() => {
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
      setTimeout(() => { o.stop(); ctx.close(); }, 60);
    }, durationMs);
  } catch (e) { /* ignore */ }
}

/* -----------------------
   Model loading
   ----------------------- */
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
    log("Face models ready");
  } catch (err) {
    console.error("Model load failed:", err);
    alert("Failed to load face models. Check ./models paths and network.");
  }
}

/* -----------------------
   Camera utils
   ----------------------- */
async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    const sel = $("cameraSelect");
    if (!sel) return;
    sel.innerHTML = "";
    cams.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = c.deviceId;
      opt.textContent = c.label || `Camera ${i+1}`;
      sel.appendChild(opt);
    });
    sel.onchange = async () => { await startCamera(sel.value); };
  } catch (e) {
    console.warn("populateCameraList failed", e);
  }
}

async function startCamera(deviceId = null) {
  try {
    stopCamera();
    const constraints = deviceId
      ? { video: { deviceId: { ideal: deviceId } } }
      : { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    // size overlay to displayed video
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    if (modelsLoaded) startDetectionLoop();
    setStatus("Camera active");
  } catch (err) {
    console.error("startCamera error", err);
    setStatus("Camera error: " + (err.message || err.name));
    alert("Camera access failed. Ensure permission and HTTPS.");
  }
}

function stopCamera() {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
  }
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  if (ctx && overlay) ctx.clearRect(0, 0, overlay.width, overlay.height);
}

/* -----------------------
   DB helpers for audits (robust)
   ----------------------- */
async function fetchAudits(limit = 10) {
  // Try DB API methods first
  try {
    if (window.dbAPI && typeof window.dbAPI.getLastAudits === "function") {
      const res = await window.dbAPI.getLastAudits(limit);
      if (Array.isArray(res)) return res;
    }
  } catch (e) { console.warn("getLastAudits failed", e); }

  try {
    if (window.dbAPI && typeof window.dbAPI.getAllAudits === "function") {
      const all = await window.dbAPI.getAllAudits();
      if (Array.isArray(all)) {
        // sort desc by timestamp if available
        all.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
        return all.slice(0, limit);
      }
    }
  } catch (e) { console.warn("getAllAudits failed", e); }

  // Fallback: try to open DB and read 'audits' object store
  try {
    if (window.dbAPI && typeof window.dbAPI.openDB === "function") {
      const db = await window.dbAPI.openDB();
      if (db && db.transaction) {
        const tx = db.transaction("audits", "readonly");
        const store = tx.objectStore("audits");
        const req = store.getAll();
        const result = await new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (Array.isArray(result)) {
          result.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
          return result.slice(0, limit);
        }
      }
    }
  } catch (e) {
    console.warn("Fallback DB read failed:", e);
  }

  return [];
}

async function showRecentAudits() {
  try {
    const recs = await fetchAudits(10);
    const container = $("recentAudits");
    if (!container) return;
    if (!recs || recs.length === 0) {
      container.innerHTML = "<em>No pickup records yet.</em>";
      return;
    }
    const html = recs.map(r => {
      // Support multiple field name shapes (some implementations store parentId/childId instead)
      const time = r.pickupTime || (r.timestamp ? new Date(r.timestamp).toLocaleString() : "");
      const parent = r.parentName || r.parentId || "parent";
      const rel = r.relation || "";
      const child = r.childName || r.childId || "child";
      const cls = r.class || r.className || "";
      const sec = r.section || r.sectionName || "";
      return `<div style="padding:4px 0;border-bottom:1px solid rgba(0,0,0,0.05);">🕒 ${time} — <strong>${escapeHtml(parent)}</strong> ${rel?`(${escapeHtml(rel)}) `:""}picked up <strong>${escapeHtml(child)}</strong> [${escapeHtml(cls)}-${escapeHtml(sec)}]</div>`;
    }).join("");
    container.innerHTML = html;
  } catch (e) {
    console.error("showRecentAudits failed", e);
  }
}

/* small escape */
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

/* -----------------------
   Build recognition matcher from DB
   ----------------------- */
async function buildMatcherFromDB() {
  try {
    if (!window.dbAPI || typeof window.dbAPI.getAllUsers !== "function") {
      recognitionMatcher = null;
      return;
    }
    const users = await window.dbAPI.getAllUsers();
    const labeled = [];
    for (const u of users) {
      if (u.descriptor && Array.isArray(u.descriptor) && u.descriptor.length >= 64) {
        labeled.push(new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)]));
      }
    }
    recognitionMatcher = labeled.length ? new faceapi.FaceMatcher(labeled, 0.55) : null;
    log("Matcher built with", labeled.length, "labels");
  } catch (e) {
    console.error("buildMatcherFromDB error", e);
  }
}

/* -----------------------
   THE DETECTION / RECOGNITION LOOP
   - Behavior:
   * if Continuous mode checked OR tempNoPickup true -> never pause
   * if Continuous is OFF and parent recognized with linked children -> pause detection (so operator can pick)
   * after Mark Pickup clicked -> add audits, set tempNoPickup true (for 10s) to avoid immediate re-showing, resume detection
   ----------------------- */
function startDetectionLoop() {
  if (!modelsLoaded) { log("models not loaded yet"); return; }
  if (detectionInterval) clearInterval(detectionInterval);

  recognitionPaused = false; // ensure unpaused

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

  detectionInterval = setInterval(async () => {
    try {
      // if paused by other logic, skip detection
      if (recognitionPaused) return;

      if (!video || video.readyState < 2) return;

      const detection = await faceapi
        .detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      // clear overlay
      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);

      const resultDiv = $("recognitionResult");
      const globalNoPickup = $("noPickupMode")?.checked ?? false;
      const effectiveNoPickup = globalNoPickup || tempNoPickup;

      if (!detection) {
        lastDetection = null;
        if (currentMode === "recognition" && resultDiv) {
          resultDiv.innerHTML = `<p style="opacity:0.6">Show a registered face...</p>`;
        }
        $("registerBtn")?.setAttribute("disabled", true);
        return;
      }

      lastDetection = detection;
      const box = detection.detection.box;
      // Scale to overlay canvas coordinates
      const scaleX = overlay.width / video.videoWidth;
      const scaleY = overlay.height / video.videoHeight;
      const drawBox = {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      };

      // Registration mode: show yellow box and enable register button
      if (currentMode === "registerParent") {
        if (ctx) {
          ctx.strokeStyle = "yellow";
          ctx.lineWidth = 2;
          ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
        }
        $("registerBtn")?.removeAttribute("disabled");
        return;
      }

      // Recognition mode
      if (currentMode === "recognition" && recognitionMatcher) {
        const best = recognitionMatcher.findBestMatch(detection.descriptor);

        if (best.label === "unknown") {
          if (ctx) {
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;
            ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
          }
          if (resultDiv) resultDiv.innerHTML = `<p style="color:#b91c1c;font-weight:bold;">❌ Unrecognized Face</p>`;
          playBeep(400, 220, "sine");
          return;
        }

        // Found a registered parent
        const users = await window.dbAPI.getAllUsers();
        const parent = users.find(u => u.name === best.label);
        if (!parent) return;

        const links = await window.dbAPI.getAllLinks();
        const children = await window.dbAPI.getAllChildren();
        const linked = links
          .filter(l => l.parentId === parent.id)
          .flatMap(l => l.childrenIds || [])
          .map(id => children.find(c => c.id === id))
          .filter(Boolean);

        // No children linked -> yellow
        if (!linked || linked.length === 0) {
          if (ctx) {
            ctx.strokeStyle = "yellow";
            ctx.lineWidth = 3;
            ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
          }
          if (resultDiv) resultDiv.innerHTML = `
            <p style="color:#eab308;font-weight:bold;">⚠️ Recognized: ${escapeHtml(best.label)}</p>
            <p>Relation: <strong>${escapeHtml(parent.role)}</strong></p>
            <p>No linked children found.</p>
          `;
          playBeep(200, 800, "triangle");
          return;
        }

        // Recognized with linked children -> green
        if (ctx) {
          ctx.strokeStyle = "lime";
          ctx.lineWidth = 3;
          ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
        }
        playBeep(100, 1000, "square");

        // If effectiveNoPickup is true, we do not present the "Mark Pickup" UI — we just continue scanning
        if (effectiveNoPickup) {
          if (resultDiv) resultDiv.innerHTML = `<p style="color:#22c55e;">Recognized ${escapeHtml(parent.name)} — continuing...</p>`;
          return;
        }

        // Else: pause recognition until operator marks pickup (to avoid repeat)
        recognitionPaused = true;

        // Build child checklist UI
        const kidsHtml = linked.map(c => `
          <label style="display:block;margin:3px 0;">
            <input type="checkbox" class="pickupChild" value="${c.id}">
            ${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})
          </label>`).join("");

        if (resultDiv) resultDiv.innerHTML = `
          <p style="color:#22c55e;font-weight:bold;">✅ Recognized: ${escapeHtml(parent.name)}</p>
          <p style="margin-top:-6px;">Relation: <strong>${escapeHtml(parent.role)}</strong></p>
          <p>Linked Children:</p>
          <div style="max-height:140px;overflow-y:auto;border:1px solid #ddd;padding:6px;border-radius:6px;">
            ${kidsHtml}
          </div>
          <div style="margin-top:8px;">
            <button id="auditBtn" disabled>Mark Pickup</button>
            <button id="cancelRecognitionBtn" style="margin-left:8px;">Cancel</button>
          </div>
          <div id="recentAudits" style="margin-top:10px;font-size:0.9rem;"></div>
        `;

        // wire up buttons & checkboxes
        const checkboxes = document.querySelectorAll(".pickupChild");
        const auditBtn = $("auditBtn");
        const cancelBtn = $("cancelRecognitionBtn");

        // enable audit button only if at least one child checked
        if (checkboxes && auditBtn) {
          checkboxes.forEach(cb => cb.addEventListener("change", () => {
            const any = Array.from(checkboxes).some(c => c.checked);
            auditBtn.disabled = !any;
          }));
        }

        // Cancel button: resume recognition without marking
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            recognitionPaused = false;
            if ($("recognitionResult")) $("recognitionResult").innerHTML = `<p style="opacity:0.6">Ready for next recognition...</p>`;
          };
        }

        // Audit button: save selected audits, then enter temporary no-pickup mode and resume scanning
        if (auditBtn) {
          auditBtn.onclick = async () => {
            const selectedIds = Array.from(document.querySelectorAll(".pickupChild:checked")).map(i => i.value);
            if (!selectedIds || selectedIds.length === 0) return alert("Select at least one child.");

            const now = new Date();
            const formatted = now.toLocaleString();

            // save audits
            for (const chId of selectedIds) {
              const ch = linked.find(x => x.id === chId);
              await window.dbAPI.addAudit({
                id: Date.now().toString() + Math.random(),
                parentName: parent.name,
                relation: parent.role,
                childName: ch.name,
                class: ch.class,
                section: ch.section,
                pickupTime: formatted,
                timestamp: Date.now()
              });
            }

            // show confirmation
            alert(`✅ Pickup marked for ${selectedIds.length} child(ren).`);

            // refresh recent audits list
            await showRecentAudits();

            // set temporary no-pickup mode (so system continues scanning without pausing for this same face)
            tempNoPickup = true;
            // resume recognition immediately
            recognitionPaused = false;

            // keep the temporary no-pickup for 10 seconds (configurable)
            setTimeout(() => { tempNoPickup = false; }, 10000);
          };
        }

        // show recent audits initially
        await showRecentAudits();
      }

    } catch (err) {
      console.error("Detection loop error:", err);
    }
  }, 600);
}

/* -----------------------
   Admin + UI modules
   ----------------------- */
function toggleCameraVisibility(show) {
  if (!video || !overlay) return;
  video.style.display = show ? "block" : "none";
  overlay.style.display = show ? "block" : "none";
}

async function loadRegisterParent() {
  currentMode = "registerParent";
  toggleCameraVisibility(true);
  $("modeContent").innerHTML = `
    <h3>Register Parent</h3>
    <label>Parent Name</label><input id="parentName" placeholder="name (lowercase will be saved)" />
    <label>Role</label><select id="parentRole"><option>father</option><option>mother</option><option>guardian</option></select>
    <div style="margin-top:8px;"><button id="registerBtn" disabled>Register</button></div>
  `;
  await startCamera();
  $("registerBtn").onclick = async () => {
    const name = $("parentName").value.trim().toLowerCase();
    const role = $("parentRole").value.trim().toLowerCase();
    if (!name) return alert("Enter parent name");
    if (!lastDetection || !lastDetection.descriptor) return alert("No face detected");
    const desc = Array.from(lastDetection.descriptor);
    await window.dbAPI.addUser({ id: Date.now().toString(), name, role, descriptor: desc });
    await buildMatcherFromDB();
    await updateStats();
    alert("Parent registered");
  };
}

async function loadClassManager() {
  currentMode = "classManager";
  toggleCameraVisibility(false);
  stopCamera();
  $("modeContent").innerHTML = `
    <h3>Classes & Sections</h3>
    <label>Class</label><input id="classInput" placeholder="e.g. 8" /><button id="addClassBtn">Add</button>
    <ul id="classList"></ul>
    <label>Section</label><input id="sectionInput" placeholder="e.g. A" /><button id="addSectionBtn">Add</button>
    <ul id="sectionList"></ul>
  `;
  $("addClassBtn").onclick = async () => {
    const v = $("classInput").value.trim().toLowerCase();
    if (!v) return alert("Enter class");
    await window.dbAPI.addClassEntry({ id: Date.now().toString(), className: v });
    $("classInput").value = "";
    refreshClassSectionLists();
  };
  $("addSectionBtn").onclick = async () => {
    const v = $("sectionInput").value.trim().toLowerCase();
    if (!v) return alert("Enter section");
    await window.dbAPI.addSectionEntry({ id: Date.now().toString(), sectionName: v });
    $("sectionInput").value = "";
    refreshClassSectionLists();
  };
  refreshClassSectionLists();
}

async function refreshClassSectionLists() {
  try {
    const classes = await window.dbAPI.getAllClasses();
    const sections = await window.dbAPI.getAllSections();
    $("classList").innerHTML = classes.map(c => `<li>${escapeHtml(c.className)}</li>`).join("");
    $("sectionList").innerHTML = sections.map(s => `<li>${escapeHtml(s.sectionName)}</li>`).join("");
  } catch (e) { console.warn("refreshClassSectionLists failed", e); }
}

async function loadRegisterChild() {
  currentMode = "registerChild";
  toggleCameraVisibility(false);
  stopCamera();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  $("modeContent").innerHTML = `
    <h3>Register Child</h3>
    <label>Child Name</label><input id="childName" />
    <label>Class</label><select id="childClass">${classes.map(c=>`<option>${escapeHtml(c.className)}</option>`).join("")}</select>
    <label>Section</label><select id="childSection">${sections.map(s=>`<option>${escapeHtml(s.sectionName)}</option>`).join("")}</select>
    <div style="margin-top:8px;"><button id="addChildBtn">Register Child</button></div>
  `;
  $("addChildBtn").onclick = async () => {
    const name = $("childName").value.trim().toLowerCase();
    const cls = $("childClass").value;
    const sec = $("childSection").value;
    if (!name) return alert("Enter child name");
    await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
    await updateStats();
    alert("Child added");
  };
}

async function loadLinkParentChild() {
  currentMode = "link";
  toggleCameraVisibility(false);
  stopCamera();
  // We'll render a search+filters UI (assumes db has getAllUsers/getAllChildren/getAllClasses/getAllSections)
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("modeContent").innerHTML = `
    <h3>Link Parent & Child</h3>
    <div style="max-width:700px;">
      <div><label>Parent (type first 3 letters)</label><input id="parentSearch" placeholder="type at least 3 letters" /></div>
      <div><select id="parentSelect" size="6" style="width:100%;"></select></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <select id="filterClass"><option value="">All Classes</option>${classes.map(c=>`<option>${escapeHtml(c.className)}</option>`).join("")}</select>
        <select id="filterSection"><option value="">All Sections</option>${sections.map(s=>`<option>${escapeHtml(s.sectionName)}</option>`).join("")}</select>
      </div>
      <div style="margin-top:8px;"><select id="childSelect" multiple size="8" style="width:100%;">${children.map(ch => `<option value="${ch.id}">${escapeHtml(ch.name)} (${escapeHtml(ch.class)}-${escapeHtml(ch.section)})</option>`).join("")}</select></div>
      <div style="margin-top:8px;"><button id="linkBtn">Link Selected</button></div>
    </div>
  `;

  const parentSearchEl = $("parentSearch");
  const parentSelectEl = $("parentSelect");
  const classFilterEl = $("filterClass");
  const sectionFilterEl = $("filterSection");
  const childSelectEl = $("childSelect");

  parentSearchEl.oninput = () => {
    const term = parentSearchEl.value.trim().toLowerCase();
    if (term.length < 3) {
      parentSelectEl.innerHTML = "<option disabled>Type at least 3 letters...</option>";
      return;
    }
    const matches = parents.filter(p => p.name.startsWith(term));
    parentSelectEl.innerHTML = matches.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${escapeHtml(m.role)})</option>`).join("") || "<option disabled>No matches</option>";
  };

  function applyChildFilters() {
    const cls = classFilterEl.value;
    const sec = sectionFilterEl.value;
    let list = children;
    if (cls) list = list.filter(c => c.class === cls);
    if (sec) list = list.filter(c => c.section === sec);
    childSelectEl.innerHTML = list.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})</option>`).join("");
  }

  classFilterEl.onchange = applyChildFilters;
  sectionFilterEl.onchange = applyChildFilters;

  $("linkBtn").onclick = async () => {
    const pid = parentSelectEl.value;
    const kids = Array.from(childSelectEl.selectedOptions).map(o => o.value);
    if (!pid) return alert("Select parent");
    if (kids.length === 0) return alert("Select children");
    await window.dbAPI.addLink({ id: Date.now().toString(), parentId: pid, childrenIds: kids });
    alert("Linked");
  };
}

/* -----------------------
   Recognition page
   ----------------------- */
async function loadRecognitionMode() {
  currentMode = "recognition";
  toggleCameraVisibility(true);
  $("modeContent").innerHTML = `<h3>Recognition Mode</h3><div id="recognitionResult">Show a registered face...</div><div style="margin-top:8px;"><label><input type="checkbox" id="noPickupMode" /> Continuous Recognition (no pickup pause)</label></div>`;
  await startCamera();
}

/* -----------------------
   Stats & menu
   ----------------------- */
async function updateStats() {
  try {
    const parents = await window.dbAPI.getAllUsers();
    const children = await window.dbAPI.getAllChildren();
    if ($("parentCount")) $("parentCount").textContent = parents.length;
    if ($("childCount")) $("childCount").textContent = children.length;
  } catch (e) { console.warn("updateStats failed", e); }
}

function setupMenu() {
  const safeBind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; else log("Menu item", id, "missing"); };
  safeBind("btnAdmin", loadRegisterParent);
  safeBind("btnClass", loadClassManager);
  safeBind("btnChild", loadRegisterChild);
  safeBind("btnLink", loadLinkParentChild);
  safeBind("btnRecognition", loadRecognitionMode);
}

/* -----------------------
   App init
   ----------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  // get elements
  video = $("video");
  overlay = $("overlay");
  ctx = overlay ? overlay.getContext("2d") : null;

  // ensure db ready
  if (window.dbAPI && typeof window.dbAPI.openDB === "function") {
    await window.dbAPI.openDB();
  } else {
    console.warn("dbAPI.openDB not present (will try to use other dbAPI methods).");
  }

  setupMenu();
  await loadFaceModels();
  await populateCameraList();
  await buildMatcherFromDB();
  await updateStats();
  setStatus("App ready");
});

/* -----------------------
   Expose for debug
   ----------------------- */
window._pickupDebug = {
  startCamera, stopCamera, startDetectionLoop, buildMatcherFromDB, fetchAudits, showRecentAudits
};
