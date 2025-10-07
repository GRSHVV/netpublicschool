"use strict";

let video, overlay, ctx;
let currentMode = "none";
let modelsLoaded = false;
let recognitionMatcher = null;
let lastDetection = null;
let detectionInterval = null;
let recognitionPaused = false;
let tempNoPickup = false;

/* DOM Helper */
const $ = (id) => document.getElementById(id);

/* ======= FACE MODELS ======= */
async function loadModels() {
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    ]);
    modelsLoaded = true;
    console.log("✅ Face API models loaded");
  } catch (e) {
    alert("Error loading models. Ensure models folder is present.");
  }
}

/* ======= CAMERA ======= */
async function startCamera(deviceId = null) {
  try {
    const constraints = deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: { facingMode: "environment" } };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    $("topPanel").style.display = "flex";
    console.log("📷 Camera started");
    if (modelsLoaded) startDetectionLoop();
  } catch (err) {
    console.error("Camera error:", err);
    alert("Camera permission denied or unavailable.");
  }
}

function stopCamera() {
  if (detectionInterval) clearInterval(detectionInterval);
  if (video?.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  $("topPanel").style.display = "none";
}

async function populateCameraList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cams = devices.filter((d) => d.kind === "videoinput");
  const sel = $("cameraSelect");
  sel.innerHTML = "";
  cams.forEach((c, i) => {
    const opt = document.createElement("option");
    opt.value = c.deviceId;
    opt.textContent = c.label || `Camera ${i + 1}`;
    sel.appendChild(opt);
  });
  sel.onchange = async () => await startCamera(sel.value);
}

/* ======= AUDIO ======= */
function playBeep(freq, duration, type = "sine") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.type = type;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, duration);
  } catch {}
}

/* ======= MATCHER ======= */
async function buildMatcher() {
  const users = await window.dbAPI.getAllUsers();
  if (!users || users.length === 0) {
    console.warn("No registered faces — matcher skipped");
    recognitionMatcher = null;
    return;
  }

  const labeled = [];
  for (const u of users) {
    if (u.descriptor && Array.isArray(u.descriptor) && u.descriptor.length >= 64) {
      labeled.push(
        new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)])
      );
    }
  }

  if (labeled.length === 0) {
    console.warn("No valid face descriptors found.");
    recognitionMatcher = null;
    return;
  }

  recognitionMatcher = new faceapi.FaceMatcher(labeled, 0.55);
  console.log("✅ Matcher built with", labeled.length, "face(s)");
}

/* ======= DETECTION LOOP ======= */
function startDetectionLoop() {
  if (!modelsLoaded) return;
  if (detectionInterval) clearInterval(detectionInterval);
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });
  recognitionPaused = false;

  detectionInterval = setInterval(async () => {
    if (recognitionPaused) return;
    if (!video || video.readyState < 2) return;

    const det = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const resultDiv = $("modeContent");

    if (!det) return;

    lastDetection = det;
    const scaleX = overlay.width / video.videoWidth;
    const scaleY = overlay.height / video.videoHeight;
    const b = det.detection.box;
    const box = {
      x: b.x * scaleX,
      y: b.y * scaleY,
      width: b.width * scaleX,
      height: b.height * scaleY,
    };

    if (currentMode === "registerParent") {
      ctx.strokeStyle = "yellow";
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      $("registerBtn")?.removeAttribute("disabled");
      return;
    }

    if (currentMode === "recognition" && recognitionMatcher) {
      const best = recognitionMatcher.findBestMatch(det.descriptor);
      if (best.label === "unknown") {
        ctx.strokeStyle = "red";
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        playBeep(400, 200);
        return;
      }

      const parent = (await window.dbAPI.getAllUsers()).find((u) => u.name === best.label);
      const links = await window.dbAPI.getAllLinks();
      const children = await window.dbAPI.getAllChildren();
      const linked = [];

      for (const link of links.filter((l) => l.parentId === parent.id)) {
        for (const ch of link.children || []) {
          const c = children.find((x) => x.id === ch.childId);
          if (c) linked.push({ ...c, relation: ch.relation });
        }
      }

      if (linked.length === 0) {
        ctx.strokeStyle = "yellow";
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        playBeep(200, 800);
        return;
      }

      ctx.strokeStyle = "lime";
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      playBeep(100, 1000);

      if ($("noPickupMode").checked || tempNoPickup) return;

      recognitionPaused = true;
      const kidsHtml = linked
        .map(
          (c) =>
            `<label><input type="checkbox" class="pickupChild" value="${c.id}">${c.name} (${c.class}-${c.section}) - <em>${c.relation}</em></label>`
        )
        .join("");

      resultDiv.innerHTML = `
        <h4>${best.label}</h4>
        ${kidsHtml}
        <button id="markBtn" disabled>Mark Pickup</button>
      `;

      const markBtn = $("markBtn");
      document.querySelectorAll(".pickupChild").forEach((cb) =>
        cb.addEventListener("change", () => {
          markBtn.disabled = !Array.from(document.querySelectorAll(".pickupChild")).some(
            (x) => x.checked
          );
        })
      );

      markBtn.onclick = async () => {
        const selected = Array.from(document.querySelectorAll(".pickupChild:checked")).map(
          (x) => x.value
        );
        const now = new Date();
        const formatted = now.toLocaleString();
        for (const sid of selected) {
          const ch = linked.find((x) => x.id === sid);
          await window.dbAPI.addAudit({
            id: Date.now().toString() + Math.random(),
            parentName: parent.name,
            relation: ch.relation,
            childName: ch.name,
            class: ch.class,
            section: ch.section,
            pickupTime: formatted,
            timestamp: Date.now(),
          });
        }
        alert(`✅ Pickup marked for ${selected.length} child(ren).`);
        tempNoPickup = true;
        recognitionPaused = false;
        setTimeout(() => (tempNoPickup = false), 8000);
      };
    }
  }, 600);
}

/* ======= MODE HELPERS ======= */
function toggleCameraVisibility(show) {
  if (show) $("topPanel").style.display = "flex";
  else $("topPanel").style.display = "none";
}

/* ======= MODULE LOADERS ======= */
async function loadRegisterParent() {
  currentMode = "registerParent";
  $("modeContent").innerHTML = `
    <h3>Register Parent</h3>
    <input id="parentName" placeholder="Parent name" />
    <button id="registerBtn" disabled>Register</button>
  `;
  toggleCameraVisibility(true);
  await startCamera();
  $("registerBtn").onclick = async () => {
    if (!lastDetection) return alert("No face detected");
    const name = $("parentName").value.trim().toLowerCase();
    if (!name) return alert("Enter name");
    const descriptor = Array.from(lastDetection.descriptor);
    await window.dbAPI.addUser({ id: Date.now().toString(), name, descriptor });
    await buildMatcher();
    alert("Parent registered successfully!");
  };
}

async function loadClassSection() {
  currentMode = "class";
  toggleCameraVisibility(false);
  $("modeContent").innerHTML = `
    <h3>Manage Classes & Sections</h3>
    <div>
      <input id="className" placeholder="Class" />
      <button id="addClass">Add Class</button>
      <ul id="classList"></ul>
      <input id="sectionName" placeholder="Section" />
      <button id="addSection">Add Section</button>
      <ul id="sectionList"></ul>
    </div>
  `;
  const render = async () => {
    const c = await window.dbAPI.getAllClasses();
    const s = await window.dbAPI.getAllSections();
    $("classList").innerHTML = c.map((x) => `<li>${x.className}</li>`).join("");
    $("sectionList").innerHTML = s.map((x) => `<li>${x.sectionName}</li>`).join("");
  };
  $("addClass").onclick = async () => {
    await window.dbAPI.addClassEntry({ id: Date.now().toString(), className: $("className").value });
    render();
  };
  $("addSection").onclick = async () => {
    await window.dbAPI.addSectionEntry({
      id: Date.now().toString(),
      sectionName: $("sectionName").value,
    });
    render();
  };
  render();
}

async function loadRegisterChild() {
  currentMode = "child";
  toggleCameraVisibility(false);
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  $("modeContent").innerHTML = `
    <h3>Register Child</h3>
    <input id="childName" placeholder="Child name" />
    <select id="childClass">${classes.map((c) => `<option>${c.className}</option>`).join("")}</select>
    <select id="childSection">${sections.map((s) => `<option>${s.sectionName}</option>`).join("")}</select>
    <button id="addChild">Register</button>
  `;
  $("addChild").onclick = async () => {
    await window.dbAPI.addChild({
      id: Date.now().toString(),
      name: $("childName").value.trim().toLowerCase(),
      class: $("childClass").value,
      section: $("childSection").value,
    });
    alert("Child registered successfully!");
  };
}

async function loadLinkParentChild() {
  currentMode = "link";
  toggleCameraVisibility(false);
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("modeContent").innerHTML = `
    <h3>Link Parent & Child</h3>
    <input id="parentSearch" placeholder="Search parent" />
    <select id="parentSelect" size="5"></select>
    <select id="classFilter"><option value="">All Classes</option>${classes
      .map((c) => `<option>${c.className}</option>`)
      .join("")}</select>
    <select id="sectionFilter"><option value="">All Sections</option>${sections
      .map((s) => `<option>${s.sectionName}</option>`)
      .join("")}</select>
    <select id="childSelect" multiple size="6" style="width:100%;"></select>
    <select id="relationSelect">
      <option value="father">Father</option>
      <option value="mother">Mother</option>
      <option value="guardian">Guardian</option>
    </select>
    <button id="linkBtn">Link</button>
  `;

  const parentSelect = $("parentSelect");
  $("parentSearch").oninput = () => {
    const val = $("parentSearch").value.toLowerCase();
    const list = parents.filter((p) => p.name.startsWith(val));
    parentSelect.innerHTML = list.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
  };

  const childSelect = $("childSelect");
  function renderChildren() {
    let list = children;
    const cf = $("classFilter").value;
    const sf = $("sectionFilter").value;
    if (cf) list = list.filter((c) => c.class === cf);
    if (sf) list = list.filter((c) => c.section === sf);
    childSelect.innerHTML = list
      .map((c) => `<option value="${c.id}">${c.name} (${c.class}-${c.section})</option>`)
      .join("");
  }
  $("classFilter").onchange = renderChildren;
  $("sectionFilter").onchange = renderChildren;
  renderChildren();

  $("linkBtn").onclick = async () => {
    const pid = parentSelect.value;
    const kids = Array.from(childSelect.selectedOptions).map((o) => o.value);
    const rel = $("relationSelect").value;
    if (!pid || kids.length === 0) return alert("Select parent & children");
    await window.dbAPI.addLink({
      id: Date.now().toString(),
      parentId: pid,
      children: kids.map((id) => ({ childId: id, relation: rel })),
    });
    alert("Linked successfully");
  };
}

async function loadRecognition() {
  currentMode = "recognition";
  $("modeContent").innerHTML = `<h3>Recognition Mode Active</h3>`;
  toggleCameraVisibility(true);
  await startCamera();
  startDetectionLoop();
}

/* ======= MENU SETUP ======= */
function setupMenu() {
  $("btnAdmin").onclick = loadRegisterParent;
  $("btnClass").onclick = loadClassSection;
  $("btnChild").onclick = loadRegisterChild;
  $("btnLink").onclick = loadLinkParentChild;
  $("btnRecognition").onclick = loadRecognition;
}

/* ======= INIT ======= */
document.addEventListener("DOMContentLoaded", async () => {
  video = $("video");
  overlay = $("overlay");
  ctx = overlay.getContext("2d");
  await window.dbAPI.openDB();
  await loadModels();
  await populateCameraList();
  try {
    await buildMatcher();
  } catch (e) {
    console.warn("Matcher skipped:", e);
  }
  setupMenu();
  toggleCameraVisibility(false); // hide by default
});
