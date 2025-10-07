"use strict";

/* -------- Globals -------- */
let video, overlay, ctx;
let currentMode = "none";
let modelsLoaded = false;
let recognitionMatcher = null;
let lastDetection = null;
let detectionInterval = null;
let recognitionPaused = false;
let tempNoPickup = false;

/* DOM helper */
const $ = (id) => document.getElementById(id);
const log = (...a) => console.log("[APP]", ...a);
const escapeHtml = (s) => (s || "").toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* -------- Load face models -------- */
async function loadModels() {
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models")
    ]);
    modelsLoaded = true;
    log("models loaded");
  } catch (e) {
    console.error("model load error", e);
    alert("Failed to load face models from ./models. Check path and files.");
  }
}

/* -------- Camera functions -------- */
async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    const sel = $("cameraSelect");
    sel.innerHTML = "";
    cams.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = c.deviceId;
      opt.textContent = c.label || `Camera ${i+1}`;
      sel.appendChild(opt);
    });
    sel.onchange = () => startCamera(sel.value);
  } catch (e) {
    console.warn("populateCameraList failed", e);
  }
}

async function startCamera(deviceId = null) {
  try {
    stopCamera();
    const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: { facingMode: "environment" } };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    // size overlay when metadata loaded
    if (video.videoWidth && video.videoHeight) {
      overlay.width = video.videoWidth;
      overlay.height = video.videoHeight;
    } else {
      video.addEventListener("loadedmetadata", () => {
        overlay.width = video.videoWidth || video.clientWidth;
        overlay.height = video.videoHeight || video.clientHeight;
      }, { once: true });
    }

    $("topPanel").style.display = "flex";

    if (modelsLoaded && currentMode === "recognition") startDetectionLoop();
  } catch (err) {
    console.error("startCamera", err);
    alert("Camera start failed. Ensure permission and HTTPS.");
  }
}

function stopCamera() {
  if (detectionInterval) { clearInterval(detectionInterval); detectionInterval = null; }
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  $("topPanel").style.display = "none";
}

/* -------- Counts -------- */
async function updateCounts() {
  try {
    const parents = await window.dbAPI.getAllUsers();
    const children = await window.dbAPI.getAllChildren();
    $("parentCount").textContent = parents.length || 0;
    $("childCount").textContent = children.length || 0;
  } catch (e) {
    console.warn("updateCounts failed", e);
  }
}

/* -------- Audio beep -------- */
function playBeep(freq = 600, dur = 120, type = "sine") {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ac.destination);
    g.gain.value = 0.001;
    o.start();
    g.gain.linearRampToValueAtTime(0.2, ac.currentTime + 0.01);
    setTimeout(() => {
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.02);
      setTimeout(() => { o.stop(); ac.close(); }, 40);
    }, dur);
  } catch (e) { /* ignore */ }
}

/* -------- Build matcher (safe) -------- */
async function buildMatcher() {
  try {
    const users = await window.dbAPI.getAllUsers();
    if (!users || users.length === 0) { recognitionMatcher = null; log("no users yet"); return; }
    const labeled = [];
    for (const u of users) {
      if (u.descriptor && Array.isArray(u.descriptor) && u.descriptor.length >= 64) {
        labeled.push(new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)]));
      }
    }
    if (labeled.length === 0) { recognitionMatcher = null; log("no valid descriptors"); return; }
    recognitionMatcher = new faceapi.FaceMatcher(labeled, 0.55);
    log("matcher built", labeled.length);
  } catch (e) {
    console.error("buildMatcher error", e);
    recognitionMatcher = null;
  }
}

/* -------- Recognition loop -------- */
function startDetectionLoop() {
  if (!modelsLoaded) return;
  if (detectionInterval) clearInterval(detectionInterval);
  recognitionPaused = false;

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

  detectionInterval = setInterval(async () => {
    try {
      if (recognitionPaused) return;
      if (!video || video.readyState < 2) return;

      const detection = await faceapi
        .detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!ctx) return;
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const resultDiv = $("modeContent");

      if (!detection) {
        if (currentMode === "recognition") resultDiv.innerHTML = `<p style="opacity:.7">Show a registered face...</p>`;
        return;
      }

      lastDetection = detection;
      const b = detection.detection.box;
      const sx = overlay.width / video.videoWidth;
      const sy = overlay.height / video.videoHeight;
      const box = { x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy };

      if (currentMode === "registerParent") {
        ctx.strokeStyle = "yellow";
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        $("registerBtn")?.removeAttribute("disabled");
        return;
      }

      if (currentMode === "recognition") {
        if (!recognitionMatcher) {
          resultDiv.innerHTML = `<p>No registered faces yet.</p>`;
          return;
        }
        const best = recognitionMatcher.findBestMatch(detection.descriptor);
        if (best.label === "unknown") {
          ctx.strokeStyle = "red"; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);
          resultDiv.innerHTML = `<p style="color:#b91c1c;font-weight:600">Unrecognized face</p>`;
          playBeep(400, 160, "sine");
          return;
        }

        // find parent, links, children
        const users = await window.dbAPI.getAllUsers();
        const parent = users.find(u => u.name === best.label);
        if (!parent) return;
        const links = await window.dbAPI.getAllLinks();
        const children = await window.dbAPI.getAllChildren();
        const linked = [];
        for (const L of links.filter(l => l.parentId === parent.id)) {
          for (const ch of L.children || []) {
            const c = children.find(x => x.id === ch.childId);
            if (c) linked.push({ ...c, relation: ch.relation || "guardian" });
          }
        }

        // draw box and respond
        if (!linked.length) {
          ctx.strokeStyle = "yellow"; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);
          resultDiv.innerHTML = `<p style="color:#eab308;font-weight:600">Recognized: ${escapeHtml(parent.name)} — no linked children</p>`;
          playBeep(250, 220, "triangle");
          return;
        }

        ctx.strokeStyle = "lime"; ctx.lineWidth = 3; ctx.strokeRect(box.x, box.y, box.width, box.height);
        playBeep(120, 200, "square");

        // if continuous/no-pickup active or tempNoPickup then do not pause
        const globalNoPickup = $("noPickupMode")?.checked ?? false;
        if (globalNoPickup || tempNoPickup) {
          resultDiv.innerHTML = `<p style="color:#16a34a;font-weight:600">Recognized ${escapeHtml(parent.name)} — continuing...</p>`;
          return;
        }

        // pause and show children list + Mark button
        recognitionPaused = true;

        const kidsHtml = linked.map(k => {
          return `<label style="display:block;margin:6px 0"><input type="checkbox" class="pickupChild" value="${escapeHtml(k.id)}"> ${escapeHtml(k.name)} (${escapeHtml(k.class)}-${escapeHtml(k.section)}) — <small>${escapeHtml(k.relation)}</small></label>`;
        }).join("");

        resultDiv.innerHTML = `
          <h3 style="margin:0 0 8px 0">${escapeHtml(parent.name)}</h3>
          <div style="max-height:160px;overflow:auto;border:1px solid #eef2ff;padding:8px;border-radius:6px">${kidsHtml}</div>
          <div style="margin-top:8px;"><button id="markPickupBtn" disabled>Mark Pickup</button> <button id="cancelPickupBtn" style="margin-left:8px">Cancel</button></div>
        `;

        // wire checkboxes
        const markBtn = $("markPickupBtn");
        document.querySelectorAll(".pickupChild").forEach(cb => cb.addEventListener("change", () => {
          const any = Array.from(document.querySelectorAll(".pickupChild")).some(x => x.checked);
          markBtn.disabled = !any;
        }));

        // cancel
        $("cancelPickupBtn").onclick = () => {
          recognitionPaused = false;
          resultDiv.innerHTML = `<p style="opacity:.7">Ready for next recognition...</p>`;
        };

        // mark pickup
        markBtn.onclick = async () => {
          const selected = Array.from(document.querySelectorAll(".pickupChild:checked")).map(x => x.value);
          if (!selected.length) return alert("Select at least one child.");
          const now = new Date();
          const formatted = now.toLocaleString();
          for (const id of selected) {
            const ch = linked.find(x => x.id === id);
            if (!ch) continue;
            await window.dbAPI.addAudit({
              id: Date.now().toString() + Math.random(),
              parentName: parent.name,
              relation: ch.relation,
              childName: ch.name,
              class: ch.class,
              section: ch.section,
              pickupTime: formatted,
              timestamp: Date.now()
            });
          }
          alert(`Pickup marked for ${selected.length} child(ren).`);
          // set tempNoPickup for brief time to avoid immediate re-detection pause
          tempNoPickup = true;
          recognitionPaused = false;
          setTimeout(() => { tempNoPickup = false; }, 9000);
          await updateCounts();
        };
      }
    } catch (err) {
      console.error("detection loop error", err);
    }
  }, 600);
}

/* -------- UI modules -------- */

function toggleCameraVisibility(show) {
  if (show) $("topPanel").style.display = "flex";
  else $("topPanel").style.display = "none";
}

/* Register Parent UI */
async function loadRegisterParent() {
  currentMode = "registerParent";
  $("modeContent").innerHTML = `
    <h3>Register Parent</h3>
    <label>Parent name (lowercase)</label>
    <input id="parentName" placeholder="e.g. rajesh" />
    <div style="margin-top:8px"><button id="registerBtn" disabled>Register</button></div>
  `;
  toggleCameraVisibility(true);
  await startCamera();

  $("registerBtn").onclick = async () => {
    try {
      if (!lastDetection) return alert("Show face to register.");
      const name = ($("parentName").value || "").trim().toLowerCase();
      if (!name) return alert("Enter name");
      const desc = Array.from(lastDetection.descriptor);
      await window.dbAPI.addUser({ id: Date.now().toString(), name, descriptor: desc });
      await buildMatcher();
      await updateCounts();
      alert("Parent registered.");
    } catch (e) {
      alert("Failed to register parent: " + (e.message || e));
      console.error(e);
    }
  };
}

/* Manage Classes & Sections UI */
async function loadClassSection() {
  currentMode = "class";
  toggleCameraVisibility(false);

  $("modeContent").innerHTML = `
    <h3>Manage Classes & Sections</h3>
    <div style="display:flex;gap:8px;flex-direction:column">
      <div>
        <input id="className" placeholder="add class (lowercase)" />
        <button id="addClass">Add Class</button>
      </div>
      <ul id="classList"></ul>

      <div style="margin-top:8px">
        <input id="sectionName" placeholder="add section (lowercase)" />
        <button id="addSection">Add Section</button>
      </div>
      <ul id="sectionList"></ul>
    </div>
  `;

  async function render() {
    const classes = await window.dbAPI.getAllClasses();
    const sections = await window.dbAPI.getAllSections();
    $("classList").innerHTML = classes.map(c => `<li>${escapeHtml(c.className)} <button class="deleteBtn" data-type="class" data-id="${c.id}">🗑</button></li>`).join("");
    $("sectionList").innerHTML = sections.map(s => `<li>${escapeHtml(s.sectionName)} <button class="deleteBtn" data-type="section" data-id="${s.id}">🗑</button></li>`).join("");

    // wire delete buttons
    document.querySelectorAll(".deleteBtn").forEach(btn => {
      btn.onclick = async () => {
        const ty = btn.dataset.type;
        const id = btn.dataset.id;
        if (!confirm("Delete this " + ty + "?")) return;
        try {
          if (ty === "class") await window.dbAPI.deleteClass(id);
          else await window.dbAPI.deleteSection(id);
          await render();
          await updateCounts();
        } catch (e) {
          console.error("delete failed", e);
          alert("Delete failed");
        }
      }
    });
  }

  $("addClass").onclick = async () => {
    const v = ($("className").value || "").trim().toLowerCase();
    if (!v) return alert("Enter class name");
    try {
      await window.dbAPI.addClassEntry({ id: Date.now().toString(), className: v });
      $("className").value = "";
      await render();
    } catch (e) {
      alert("Failed to add class: " + (e.message || ""));
    }
  };

  $("addSection").onclick = async () => {
    const v = ($("sectionName").value || "").trim().toLowerCase();
    if (!v) return alert("Enter section name");
    try {
      await window.dbAPI.addSectionEntry({ id: Date.now().toString(), sectionName: v });
      $("sectionName").value = "";
      await render();
    } catch (e) {
      alert("Failed to add section: " + (e.message || ""));
    }
  };

  await render();
}

/* Register Child UI */
async function loadRegisterChild() {
  currentMode = "child";
  toggleCameraVisibility(false);

  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("modeContent").innerHTML = `
    <h3>Register Child</h3>
    <label>Child name</label>
    <input id="childName" placeholder="child name (lowercase)" />
    <label>Class</label>
    <select id="childClass">${classes.map(c => `<option value="${escapeHtml(c.className)}">${escapeHtml(c.className)}</option>`).join("")}</select>
    <label>Section</label>
    <select id="childSection">${sections.map(s => `<option value="${escapeHtml(s.sectionName)}">${escapeHtml(s.sectionName)}</option>`).join("")}</select>
    <div style="margin-top:8px"><button id="addChild">Register Child</button></div>
  `;

  $("addChild").onclick = async () => {
    const name = ($("childName").value || "").trim().toLowerCase();
    const cls = ($("childClass").value || "").trim().toLowerCase();
    const sec = ($("childSection").value || "").trim().toLowerCase();
    if (!name) return alert("Enter child name");
    try {
      await window.dbAPI.addChild({ id: Date.now().toString(), name, class: cls, section: sec });
      $("childName").value = "";
      await updateCounts();
      alert("Child added");
    } catch (e) {
      console.error("addChild failed", e);
      alert("Failed to add child");
    }
  };
}

/* Link Parent–Child UI */
async function loadLinkParentChild() {
  currentMode = "link";
  toggleCameraVisibility(false);

  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("modeContent").innerHTML = `
    <h3>Link Parent & Child</h3>
    <label>Search parent (type first 3 letters)</label>
    <input id="parentSearch" placeholder="start typing..." />
    <select id="parentSelect" size="6" style="width:100%"></select>

    <div style="display:flex;gap:8px;margin-top:8px">
      <select id="filterClass"><option value="">All classes</option>${classes.map(c => `<option value="${escapeHtml(c.className)}">${escapeHtml(c.className)}</option>`).join("")}</select>
      <select id="filterSection"><option value="">All sections</option>${sections.map(s => `<option value="${escapeHtml(s.sectionName)}">${escapeHtml(s.sectionName)}</option>`).join("")}</select>
    </div>

    <label style="margin-top:8px">Children (select one or more)</label>
    <select id="childrenSelect" multiple size="6" style="width:100%"></select>

    <label>Relation to selected children</label>
    <select id="relationForLink"><option value="father">father</option><option value="mother">mother</option><option value="guardian">guardian</option></select>

    <div style="margin-top:8px"><button id="linkBtn">Link Selected</button></div>
  `;

  const parentSelect = $("parentSelect");
  const parentSearch = $("parentSearch");
  const childrenSelect = $("childrenSelect");
  const filterClass = $("filterClass");
  const filterSection = $("filterSection");

  function renderChildren() {
    let list = children;
    const cf = filterClass.value;
    const sf = filterSection.value;
    if (cf) list = list.filter(x => x.class === cf);
    if (sf) list = list.filter(x => x.section === sf);
    childrenSelect.innerHTML = list.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.class)}-${escapeHtml(c.section)})</option>`).join("");
  }
  renderChildren();
  filterClass.onchange = renderChildren;
  filterSection.onchange = renderChildren;

  parentSearch.oninput = () => {
    const q = (parentSearch.value || "").trim().toLowerCase();
    if (q.length < 1) { parentSelect.innerHTML = ""; return; }
    const matches = parents.filter(p => p.name.startsWith(q));
    parentSelect.innerHTML = matches.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  };

  $("linkBtn").onclick = async () => {
    const pid = parentSelect.value;
    const selectedKids = Array.from(childrenSelect.selectedOptions).map(o => o.value);
    const rel = ($("relationForLink").value || "guardian").trim().toLowerCase();
    if (!pid || !selectedKids.length) return alert("Select parent and children");
    const childrenArr = selectedKids.map(id => ({ childId: id, relation: rel }));
    await window.dbAPI.addLink({ id: Date.now().toString(), parentId: pid, children: childrenArr });
    alert("Linked");
  };
}

/* Recognition loader */
async function loadRecognition() {
  currentMode = "recognition";
  $("modeContent").innerHTML = `<h3>Recognition Mode</h3><div style="margin-top:6px">Show a registered parent in camera.</div>`;
  toggleCameraVisibility(true);
  await startCamera();
  if (modelsLoaded) await buildMatcher();
  startDetectionLoop();
}

/* Setup menu wiring */
function setupMenu() {
  $("btnAdmin").onclick = loadRegisterParent;
  $("btnClass").onclick = loadClassSection;
  $("btnChild").onclick = loadRegisterChild;
  $("btnLink").onclick = loadLinkParentChild;
  $("btnRecognition").onclick = loadRecognition;
}

/* Init */
document.addEventListener("DOMContentLoaded", async () => {
  video = $("video");
  overlay = $("overlay");
  ctx = overlay.getContext("2d");

  try {
    await window.dbAPI.openDB();
  } catch (e) {
    alert("IndexedDB open failed: " + e.message);
    console.error(e);
    return;
  }

  await loadModels();
  await populateCameraList();
  try { await buildMatcher(); } catch(e) { console.warn("buildMatcher skipped", e); }
  setupMenu();
  await updateCounts();
  toggleCameraVisibility(false);
});
