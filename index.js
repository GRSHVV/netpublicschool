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
let lastRecognizedParentId = null;
let lastRecognitionTime = 0;


/* -----------------------
   DOM helpers
   ----------------------- */
const $ = (id) => document.getElementById(id);
const log = (...args) => console.log("[APP]", ...args);
function setStatus(msg) { const e = $("statusMsg"); if (e) e.textContent = msg; }

const params = new URLSearchParams(window.location.search);
const maxfaces = parseInt(params.get("limit") || "2");
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
/* ============================================================
   Helper: Check if audit exists for same parent–child on same day
   ============================================================ */
async function auditExistsToday(parentName, childName) {
  try {
    const all = await window.dbAPI.getAllAudits();
    if (!Array.isArray(all)) return false;

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const endOfDay = startOfDay + 86400000; // +24h

    for (const a of all) {
      if (
        a.parentName === parentName &&
        a.childName === childName &&
        a.timestamp >= startOfDay &&
        a.timestamp < endOfDay
      ) {
        return true;
      }
    }
    return false;
  } catch (err) {
    console.warn("auditExistsToday failed:", err);
    return false;
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
   DASHBOARD SCREEN
   ----------------------- */
async function loadDashboard() {
  currentMode = "dashboard";
  toggleCameraVisibility(false);
  stopCamera();

  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const links = await window.dbAPI.getAllLinks();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  // Build grade × section summary
  const grid = [];
  for (const c of classes) {
    for (const s of sections) {
      const childrenInGroup = children.filter(ch => ch.class === c.className && ch.section === s.sectionName);
      const childCount = childrenInGroup.length;

      // count distinct linked parents
      const linkedParentIds = links
        .filter(l => childrenInGroup.some(ch => ch.id === l.childId))
        .map(l => l.parentId);
      const uniqueParentCount = [...new Set(linkedParentIds)].length;

      grid.push({
        class: c.className,
        section: s.sectionName,
        children: childCount,
        linkedParents: uniqueParentCount
      });
    }
  }

  $("modeContent").innerHTML = `
    <h3>🏫 School Dashboard</h3>
    <div style="display:flex;gap:20px;margin-bottom:15px;flex-wrap:wrap;">
      <div style="background:#f1f5f9;padding:10px 16px;border-radius:8px;">👨‍👩‍👧‍👦 Parents: <strong>${parents.length}</strong></div>
      <div style="background:#f1f5f9;padding:10px 16px;border-radius:8px;">🧒 Children: <strong>${children.length}</strong></div>
      <div style="background:#f1f5f9;padding:10px 16px;border-radius:8px;">🔗 Links: <strong>${links.length}</strong></div>
    </div>
    <div style="overflow:auto;max-height:350px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#e2e8f0;">
            <th style="text-align:left;padding:6px;">Class</th>
            <th style="text-align:left;padding:6px;">Section</th>
            <th style="text-align:right;padding:6px;">Children</th>
            <th style="text-align:right;padding:6px;">Linked Parents</th>
          </tr>
        </thead>
        <tbody>
          ${grid.map(g => `
            <tr>
              <td style="padding:6px;">${escapeHtml(g.class)}</td>
              <td style="padding:6px;">${escapeHtml(g.section)}</td>
              <td style="padding:6px;text-align:right;">${g.children}</td>
              <td style="padding:6px;text-align:right;">${g.linkedParents}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
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
        //reset  recognition tracking
        lastRecognizedParentId = null;
        if (best.label === "unknown") {
          if (ctx) {
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;
            ctx.strokeRect(drawBox.x, drawBox.y, drawBox.width, drawBox.height);
          }
          if (resultDiv) resultDiv.innerHTML = `<p style="color:#b91c1c;font-weight:bold;">❌ Unrecognized Face</p>`;
          playBeep(300, 1000, "square");
          return;
        }

        // Found a registered parent
        const users = await window.dbAPI.getAllUsers();
        const parent = users.find(u => u.name === best.label);
        if (!parent) return;

        const links = await window.dbAPI.getAllLinks();
        const children = await window.dbAPI.getAllChildren();

        // Each link has: { parentId, childId, relation }
        const linked = links
          .filter(l => l.parentId === parent.id)
          .map(link => {
        const c = children.find(ch => ch.id === link.childId);
        return c ? { ...c, relation: link.relation || "guardian" } : null;
      })
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
        playBeep(100, 1000, "sine");

        // If effectiveNoPickup is true, we do not present the "Mark Pickup" UI — we just continue scanning
        if (effectiveNoPickup) {
        // Continuous recognition (auto-mark)
        const now = Date.now();

        // Avoid duplicate logging for the same parent within 10 seconds
        if (parent.id === lastRecognizedParentId && (now - lastRecognitionTime) < 43200000) {
          if (resultDiv) resultDiv.innerHTML = `<p style="color:#22c55e;">Recognized ${escapeHtml(parent.name)} — already logged.</p>`;
          //return;
        }
      
        // Update last recognized parent
        lastRecognizedParentId = parent.id;
        lastRecognitionTime = now;
      
        // Auto-generate audit records for all linked children
        if (linked && linked.length > 0) {
          const formatted = new Date().toLocaleString();
          let newCount = 0;
          for (const ch of linked) {
            
            alert("parent recognized" + parent.name);
            auditExistsAlready = await auditExistsToday(parent.name,ch.name);
            alert(auditExistsAlready);
            
            alert("linked child" + ch.name);
            
            if(!auditExistsAlready){
              alert("creating audit record");
              await window.dbAPI.addAudit({
                id: `${Date.now()}-${Math.random()}`,
                parentName: parent.name,
                relation: parent.role || "parent",
                childName: ch.name,
                class: ch.class,
                section: ch.section,
                pickupTime: formatted,
                timestamp: Date.now()
              });
              newCount++;
            }
            
          }
          if(newCount > 0){ //new audit record added 
            playBeep(100, 1200, "sine");
            if (resultDiv)
              resultDiv.innerHTML = `<p style="color:#22c55e;font-weight:bold;">✅ ${escapeHtml(parent.name)} recognized — ${linked.length} pickup(s) logged automatically.</p>`;
            await showRecentAudits();
          }  
        } else { //linked lenth == 0
          if (resultDiv)
            resultDiv.innerHTML = `<p style="color:#facc15;">⚠️ Recognized ${escapeHtml(parent.name)} — but no linked children found.</p>`;
          playBeep(200, 800, "triangle");
        }
      
        // Continue scanning next faces
        return;
      }


        // Else: pause recognition until operator marks pickup (to avoid repeat)
        recognitionPaused = true;

        // Build child checklist UI
        const kidsHtml = linked.map(c => `
          <label style="display:block;margin:3px 0;">
          <input type="checkbox" class="pickupChild" value="${c.id}">
          ${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)}) — 
          <em>${escapeHtml(c.relation)}</em>
          </label>`).join("");

        if (resultDiv) resultDiv.innerHTML = `
          <p style="color:#22c55e;font-weight:bold;">✅ Recognized: ${escapeHtml(parent.name)}</p>
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
              const link = links.find(l => l.parentId === parent.id && l.childId === ch.id);
              await window.dbAPI.addAudit({
                id: Date.now().toString() + Math.random(),
                parentName: parent.name,
                relation: link?.relation || "guardian",
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
    <!--<label>Role</label><select id="parentRole"><option>father</option><option>mother</option><option>guardian</option></select>-->
    <div style="margin-top:8px;"><button id="registerBtn" disabled>Register</button></div>
  `;
  await startCamera();
  $("registerBtn").onclick = async () => {
    const name = $("parentName").value.trim().toLowerCase();
    //const role = $("parentRole").value.trim().toLowerCase();
    if (!name) return alert("Enter parent name");
    if (!lastDetection || !lastDetection.descriptor) return alert("No face detected");
    const desc = Array.from(lastDetection.descriptor);
    const allUsers =  await window.dbAPI.getAllUsers();
    if(allUsers.length > = maxfaces){
      alert('you have reached your subscribed quota  (${maxfaces} faces limit).');
      return;
    }
    await window.dbAPI.addUser({ id: Date.now().toString(), name, descriptor: desc });
    await buildMatcherFromDB();
    await updateStats();
    alert("Parent registered");
    //await loadDashboard();

  };
}
/* ============================================================
   UPDATE EXISTING PARENT DETAILS OR FACE
   ============================================================ */
async function loadUpdateParent() {
  currentMode = "updateParent";
  toggleCameraVisibility(true);
  $("modeContent").innerHTML = `
    <h3>Update Parent</h3>
    <label>Search Parent (type 3 letters):</label>
    <input id="searchParentInput" placeholder="type at least 3 letters" />
    <select id="parentSelect" size="6" style="width:100%;margin-top:8px;"></select>
    <label style="margin-top:8px;">New Name (optional):</label>
    <input id="newParentName" placeholder="leave empty if name not changing" />
    <div style="margin-top:10px;">
      <button id="updateFaceBtn" disabled>Update Face</button>
      <button id="saveParentUpdateBtn" style="margin-left:8px;">Save</button>
    </div>
  `;

  await startCamera();
  const parents = await window.dbAPI.getAllUsers();

  const searchInput = $("searchParentInput");
  const selectEl = $("parentSelect");
  const updateBtn = $("updateFaceBtn");
  const saveBtn = $("saveParentUpdateBtn");

  // Search parent
  searchInput.oninput = () => {
    const term = searchInput.value.trim().toLowerCase();
    if (term.length < 3) {
      selectEl.innerHTML = "<option disabled>Type at least 3 letters...</option>";
      return;
    }
    const matches = parents.filter(p => p.name.startsWith(term));
    selectEl.innerHTML = matches.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("") || "<option disabled>No matches</option>";
  };

  // Enable update button when a face is detected
  detectionInterval && clearInterval(detectionInterval);
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
  detectionInterval = setInterval(async () => {
    if (!video || video.readyState < 2) return;
    const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks().withFaceDescriptor();
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (detection) {
      const box = detection.detection.box;
      ctx.strokeStyle = "yellow";
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      lastDetection = detection;
      updateBtn.disabled = false;
    } else {
      updateBtn.disabled = true;
    }
  }, 800);

  // Save face descriptor when clicked
  updateBtn.onclick = () => {
    if (!lastDetection || !lastDetection.descriptor) return alert("No face detected!");
    alert("✅ Face captured. Click Save to update record.");
  };

  // Save updated record
  saveBtn.onclick = async () => {
    const selectedId = selectEl.value;
    if (!selectedId) return alert("Select a parent");
    const parent = parents.find(p => p.id === selectedId);
    if (!parent) return alert("Parent not found");

    const newName = $("newParentName").value.trim().toLowerCase() || parent.name;
    const updatedDesc = lastDetection?.descriptor ? Array.from(lastDetection.descriptor) : parent.descriptor;

    await window.dbAPI.updateUser({ ...parent, name: newName, descriptor: updatedDesc });
    await buildMatcherFromDB();
    alert("✅ Parent details updated successfully");
    //await loadDashboard();
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
    //await loadDashboard();

  };
  $("addSectionBtn").onclick = async () => {
    const v = $("sectionInput").value.trim().toLowerCase();
    if (!v) return alert("Enter section");
    await window.dbAPI.addSectionEntry({ id: Date.now().toString(), sectionName: v });
    $("sectionInput").value = "";
    refreshClassSectionLists();
    //await loadDashboard();
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
   // await loadDashboard();

    
  };
}

async function loadLinkParentChild() {
  currentMode = "link";
  toggleCameraVisibility(false);
  stopCamera();

  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("modeContent").innerHTML = `
    <h3>Link Parent & Child (with Relation)</h3>
    <div style="max-width:700px;">
      <div><label>Parent (type first 3 letters)</label><input id="parentSearch" placeholder="type at least 3 letters" /></div>
      <div><select id="parentSelect" size="6" style="width:100%;"></select></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <select id="filterClass"><option value="">All Classes</option>${classes.map(c=>`<option>${escapeHtml(c.className)}</option>`).join("")}</select>
        <select id="filterSection"><option value="">All Sections</option>${sections.map(s=>`<option>${escapeHtml(s.sectionName)}</option>`).join("")}</select>
      </div>
      <div style="margin-top:8px;">
        <select id="childSelect" multiple size="8" style="width:100%;">
          ${children.map(ch => `<option value="${ch.id}">${escapeHtml(ch.name)} (${escapeHtml(ch.class)}-${escapeHtml(ch.section)})</option>`).join("")}
        </select>
      </div>

      <div id="relationContainer" style="margin-top:10px;"></div>
      <div style="margin-top:10px;"><button id="linkBtn">Link Selected</button></div>
    </div>
  `;

  const parentSearchEl = $("parentSearch");
  const parentSelectEl = $("parentSelect");
  const classFilterEl = $("filterClass");
  const sectionFilterEl = $("filterSection");
  const childSelectEl = $("childSelect");
  const relationContainer = $("relationContainer");

  parentSearchEl.oninput = () => {
    const term = parentSearchEl.value.trim().toLowerCase();
    if (term.length < 3) {
      parentSelectEl.innerHTML = "<option disabled>Type at least 3 letters...</option>";
      return;
    }
    const matches = parents.filter(p => p.name.startsWith(term));
    parentSelectEl.innerHTML = matches
      .map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
      .join("") || "<option disabled>No matches</option>";
  };

  function applyChildFilters() {
    const cls = classFilterEl.value;
    const sec = sectionFilterEl.value;
    let list = children;
    if (cls) list = list.filter(c => c.class === cls);
    if (sec) list = list.filter(c => c.section === sec);
    childSelectEl.innerHTML = list
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})</option>`)
      .join("");
  }

  classFilterEl.onchange = applyChildFilters;
  sectionFilterEl.onchange = applyChildFilters;

  // When child selection changes → show relation dropdowns
  childSelectEl.onchange = () => {
    const selected = Array.from(childSelectEl.selectedOptions);
    if (!selected.length) {
      relationContainer.innerHTML = "";
      return;
    }

    relationContainer.innerHTML = `
      <h4 style="margin-bottom:6px;">Select Relation(s):</h4>
      ${selected.map(
        (opt) => `
        <div style="margin:3px 0;">
          <label>${escapeHtml(opt.textContent)}:</label>
          <select class="relationSelect" data-child="${opt.value}" style="margin-left:6px;">
            <option value="father">Father</option>
            <option value="mother">Mother</option>
            <option value="guardian">Guardian</option>
          </select>
        </div>`
      ).join("")}
    `;
  };

  $("linkBtn").onclick = async () => {
    const pid = parentSelectEl.value;
    const selectedRelations = Array.from(document.querySelectorAll(".relationSelect")).map(sel => ({
      childId: sel.dataset.child,
      relation: sel.value
    }));

    if (!pid) return alert("Select a parent");
    if (!selectedRelations.length) return alert("Select at least one child and relation");

    // Save each link record individually
    for (const rel of selectedRelations) {
      await window.dbAPI.addLink({
        id: Date.now().toString() + Math.random(),
        parentId: pid,
        childId: rel.childId,
        relation: rel.relation
      });
    }

    alert("✅ Parent–Child link(s) saved successfully!");
    //await loadDashboard();

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

/* ======= Reports Section ======= */
async function loadReports() {
  toggleCameraVisibility(false);
  $("modeContent").innerHTML = `
    <h3>Audit Reports</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <div>
        <label>From:</label>
        <input type="date" id="reportFrom" />
      </div>
      <div>
        <label>To:</label>
        <input type="date" id="reportTo" />
      </div>
      <div>
        <label>Class:</label>
        <select id="reportClass"><option value="">All</option></select>
      </div>
      <div>
        <label>Section:</label>
        <select id="reportSection"><option value="">All</option></select>
      </div>
      <div style="align-self:flex-end;">
        <button id="runReport">Run Report</button>
      </div>
    </div>
    <div id="reportResults" style="max-height:350px;overflow:auto;"></div>
  `;

  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("reportClass").innerHTML += classes
    .map((c) => `<option value="${c.className}">${c.className}</option>`)
    .join("");
  $("reportSection").innerHTML += sections
    .map((s) => `<option value="${s.sectionName}">${s.sectionName}</option>`)
    .join("");

  $("runReport").onclick = async () => {
  const from = $("reportFrom").value ? new Date($("reportFrom").value).getTime() : 0;
  const to = $("reportTo").value ? new Date($("reportTo").value).getTime() + 86400000 : Date.now();
  const cls = $("reportClass").value;
  const sec = $("reportSection").value;

  const audits = await window.dbAPI.getAllAudits();
  const links = await window.dbAPI.getAllLinks();

  // Apply date/class/section filters
  const filtered = audits.filter((a) => {
    const time = a.timestamp || new Date(a.pickupTime).getTime();
    const matchDate = time >= from && time <= to;
    const matchClass = !cls || (a.class && a.class === cls);
    const matchSec = !sec || (a.section && a.section === sec);
    return matchDate && matchClass && matchSec;
  });

  if (!filtered.length) {
    $("reportResults").innerHTML = `<p style="color:#999">No records found for selected filters.</p>`;
    return;
  }

  // Enrich with relation (fallback to link if missing)
  const enriched = filtered.map(a => {
    if (a.relation) return a; // already has relation
    const link = links.find(
      l =>
        (l.parentId === a.parentId || a.parentName?.toLowerCase().includes(l.parentId?.toLowerCase() || "")) &&
        (l.childId === a.childId || a.childName?.toLowerCase().includes(l.childId?.toLowerCase() || ""))
    );
    return { ...a, relation: link?.relation || "guardian" };
  });

  // Build table rows
  const rows = enriched
    .map(
      (r) => `
      <tr>
        <td>${r.pickupTime || new Date(r.timestamp).toLocaleString()}</td>
        <td>${escapeHtml(r.parentName || "-")}</td>
        <td>${escapeHtml(r.childName || "-")}</td>
        <td>${escapeHtml(r.class || "-")}</td>
        <td>${escapeHtml(r.section || "-")}</td>
        <td>${escapeHtml(r.relation || "-")}</td>
      </tr>`
    )
    .join("");

  $("reportResults").innerHTML = `
    <table id="reportTable" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f8fafc;">
          <th>Date/Time</th>
          <th>Parent</th>
          <th>Child</th>
          <th>Class</th>
          <th>Section</th>
          <th>Relation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px;">
      <button id="downloadCsvBtn">⬇️ Download CSV</button>
    </div>
  `;

  // CSV Export
  $("downloadCsvBtn").onclick = () => {
    const csvRows = [
      ["Date/Time", "Parent", "Child", "Class", "Section", "Relation"],
      ...enriched.map(r => [
        r.pickupTime || new Date(r.timestamp).toLocaleString(),
        r.parentName || "-",
        r.childName || "-",
        r.class || "-",
        r.section || "-",
        r.relation || "-"
      ])
    ];
    const csv = csvRows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit_report_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
};
}

/* ======= Data Export / Import ======= */
/* ======= Export Data (ZIP) – fixed ======= */
async function exportDataZip() {
  const pass = prompt("Enter password to export data:");
  if (pass !== "CBwbzgo@123") {
    alert("❌ Incorrect password!");
    return;
  }

  const zip = new JSZip();

  const stores = [
    { name: "parents",     fn: window.dbAPI.getAllUsers },
    { name: "children",  fn: window.dbAPI.getAllChildren },
    { name: "classes",   fn: window.dbAPI.getAllClasses },
    { name: "sections",  fn: window.dbAPI.getAllSections },
    { name: "links",     fn: window.dbAPI.getAllLinks },
    { name: "audits",    fn: window.dbAPI.getAllAudits }
  ];

  for (const s of stores) {
    try {
      const data = (await s.fn.call(window.dbAPI)) || [];
      zip.file(`${s.name}.json`, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`Error reading ${s.name}:`, e);
      zip.file(`${s.name}.json`, "[]");
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `school_data_backup_${new Date().toISOString().split("T")[0]}.zip`;
  a.click();
  URL.revokeObjectURL(a.href);
  alert("✅ Data exported successfully!");
}

/* ======= Import Data (ZIP) – UI Form Version ======= */
function importDataZip() {
  $("modeContent").innerHTML = `
    <h3>Import School Data</h3>
    <p style="color:#555;">Upload a ZIP file previously exported from this system.</p>
    <form id="importForm" style="margin-top:10px;">
      <label>Password:</label><br/>
      <input type="password" id="importPass" placeholder="Enter admin password" required style="margin-bottom:8px;width:60%;"/><br/>
      <label>Choose ZIP File:</label><br/>
      <input type="file" id="zipFileInput" accept=".zip" required style="margin-bottom:10px;"/><br/>
      <button type="submit" id="startImport">Start Import</button>
    </form>
    <div id="importStatus" style="margin-top:12px;color:#444;"></div>
  `;

  const form = $("importForm");
  const passInput = $("importPass");
  const fileInput = $("zipFileInput");
  const statusDiv = $("importStatus");

  form.onsubmit = async (e) => {
    e.preventDefault();

    if (passInput.value !== "CBwbzgo@123") {
      alert("❌ Incorrect password!");
      return;
    }

    const file = fileInput.files[0];
    if (!file) {
      alert("Please select a ZIP file.");
      return;
    }

    statusDiv.innerHTML = "📦 Importing... please wait.";

    try {
      const zip = await JSZip.loadAsync(file);
      const stores = ["parents", "children", "classes", "sections", "links", "audits"];

      for (const storeName of stores) {
        const zipFile = zip.file(`${storeName}.json`);
        if (!zipFile) continue;

        const content = await zipFile.async("string");
        const data = JSON.parse(content || "[]");
        const db = await window.dbAPI.openDB();
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.clear();

        for (const item of data) {
          store.put(item);
        }
      }

      statusDiv.innerHTML = "✅ Import complete! Data successfully restored.";
      alert("✅ Data imported successfully!");
      setTimeout(() => location.reload(), 2000);
    } catch (err) {
      console.error("Import error:", err);
      statusDiv.innerHTML = "❌ Import failed. Check console for details.";
      alert("❌ Failed to import data.");
    }
  };
}


function setupMenu() {
  const safeBind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; else log("Menu item", id, "missing"); };
  safeBind("btnAdmin", loadRegisterParent);
  safeBind("btnClass", loadClassManager);
  safeBind("btnChild", loadRegisterChild);
  safeBind("btnLink", loadLinkParentChild);
  safeBind("btnRecognition", loadRecognitionMode);
  safeBind("btnReports", loadReports);
  safeBind("btnExport", exportDataZip);
  safeBind("btnImport", importDataZip);
  safeBind("btnDashboard", loadDashboard);
  safeBind("btnUpdateParent", loadUpdateParent);


  
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
  await loadDashboard();

  setStatus("App ready");
});

/* -----------------------
   Expose for debug
   ----------------------- */
window._pickupDebug = {
  startCamera, stopCamera, startDetectionLoop, buildMatcherFromDB, fetchAudits, showRecentAudits
};











