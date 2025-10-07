"use strict";

let video, overlay, ctx;
let modelsLoaded = false;
let detectionInterval = null;
let recognitionMatcher = null;
let lastDetection = null;

const $ = (id) => document.getElementById(id);

/* ======= MODEL LOADING ======= */
async function loadModels() {
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    ]);
    modelsLoaded = true;
    console.log("✅ Models loaded successfully");
  } catch (e) {
    console.error("Model load error:", e);
    alert("Failed to load face models. Please check the ./models folder.");
  }
}

/* ======= CAMERA ======= */
async function startCamera(deviceId = null, facing = "environment") {
  try {
    stopCamera();
    const constraints = deviceId
      ? { video: { deviceId: { exact: deviceId } } }
      : { video: { facingMode: facing } };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await new Promise((r) => (video.onloadedmetadata = r));
    video.play();

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    console.log(`📷 Camera started (${video.videoWidth}x${video.videoHeight})`);
    startDetectionLoop();
  } catch (err) {
    console.error("Camera start error:", err);
    alert("Camera access denied or unavailable.");
  }
}

function stopCamera() {
  if (detectionInterval) clearInterval(detectionInterval);
  if (video && video.srcObject)
    video.srcObject.getTracks().forEach((t) => t.stop());
}

/* ======= CAMERA SELECTION ======= */
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
  sel.onchange = () => startCamera(sel.value);
}

/* ======= MATCHER ======= */
async function buildMatcher() {
  const users = await window.dbAPI.getAllUsers();
  const labeled = [];
  for (const u of users) {
    if (u.descriptor)
      labeled.push(
        new faceapi.LabeledFaceDescriptors(u.name, [
          new Float32Array(u.descriptor),
        ])
      );
  }
  recognitionMatcher = labeled.length
    ? new faceapi.FaceMatcher(labeled, 0.55)
    : null;
}

/* ======= DETECTION LOOP ======= */
function startDetectionLoop() {
  if (!modelsLoaded) return;
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: 224,
    scoreThreshold: 0.4,
  });

  if (detectionInterval) clearInterval(detectionInterval);
  detectionInterval = setInterval(async () => {
    const resultDiv = $("modeContent");
    const det = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!det) return;

    lastDetection = det;
    const settings = video.srcObject.getVideoTracks()[0].getSettings();
    const facing = settings.facingMode || "environment";
    const box = det.detection.box;

    ctx.save();
    if (facing === "user") {
      ctx.translate(overlay.width, 0);
      ctx.scale(-1, 1);
      ctx.strokeStyle = "lime";
      ctx.lineWidth = 3;
      ctx.strokeRect(
        overlay.width - box.x - box.width,
        box.y,
        box.width,
        box.height
      );
    } else {
      ctx.strokeStyle = "lime";
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
    }
    ctx.restore();

    if (recognitionMatcher) {
      const best = recognitionMatcher.findBestMatch(det.descriptor);

      // === Find linked children correctly (new schema) ===
      const users = await window.dbAPI.getAllUsers();
      const parent = users.find((u) => u.name === best.label);
      if (!parent) {
        resultDiv.innerHTML = `<p style="color:#b91c1c">Unrecognized face</p>`;
        return;
      }

      const links = await window.dbAPI.getAllLinks();
      const children = await window.dbAPI.getAllChildren();
      const linked = [];

      for (const link of links) {
        if (link.parentId !== parent.id) continue;
        for (const item of link.children || []) {
          const child = children.find((c) => c.id === item.childId);
          if (child) {
            linked.push({
              id: child.id,
              name: child.name,
              class: child.class,
              section: child.section,
              relation: item.relation || "guardian",
            });
          }
        }
      }

      if (linked.length === 0) {
        resultDiv.innerHTML = `<p style="color:#eab308;font-weight:600">Recognized ${parent.name} — no linked children found</p>`;
        return;
      }

      const kidsHtml = linked
        .map(
          (k) =>
            `<div style="margin:6px 0;"><b>${k.name}</b> (${k.class}-${k.section}) — <small>${k.relation}</small></div>`
        )
        .join("");

      resultDiv.innerHTML = `
        <h3>${parent.name}</h3>
        <p>Linked Children:</p>
        <div style="border:1px solid #eee;padding:8px;border-radius:6px;">
          ${kidsHtml}
        </div>
      `;
    }
  }, 400);
}

/* ======= COUNTS ======= */
async function updateCounts() {
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  $("parentCount").textContent = parents.length;
  $("childCount").textContent = children.length;
}

/* ======= Register Parent (relation removed) ======= */
async function loadRegisterParent() {
  $("modeContent").innerHTML = `
    <h3>Register Parent</h3>
    <label>Parent Name:</label>
    <input id="parentName" placeholder="enter name in lowercase" />
    <button id="registerBtn">Register</button>
  `;

  await startCamera();
  startDetectionLoop(); // ensure detection loop runs

  $("registerBtn").onclick = async () => {
    const name = $("parentName").value.trim().toLowerCase();
    if (!name || !lastDetection) return alert("Show face before registering!");

    const descriptor = Array.from(lastDetection.descriptor);
    await window.dbAPI.addUser({ id: Date.now().toString(), name, descriptor });
    await buildMatcher();
    await updateCounts();

    alert("✅ Parent registered successfully.");
  };
}

/* ======= Link Parent–Child with Relation Selection ======= */
async function loadLinkParentChild() {
  $("modeContent").innerHTML = `
    <h3>Link Parent & Child</h3>
    <label>Search Parent:</label>
    <input id="parentSearch" placeholder="type first 3 letters of parent name" />
    <select id="parentSelect" size="5" style="width:100%;margin-bottom:8px;"></select>

    <div style="display:flex;gap:8px;margin-bottom:8px;">
      <select id="filterClass"><option value="">All Classes</option></select>
      <select id="filterSection"><option value="">All Sections</option></select>
    </div>

    <label>Select Children to Link:</label>
    <select id="childrenSelect" multiple size="6" style="width:100%;margin-bottom:8px;"></select>

    <div id="relationContainer" style="margin-bottom:10px;"></div>
    <button id="linkBtn">Link Selected</button>
  `;

  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  $("filterClass").innerHTML += classes
    .map((c) => `<option value="${c.className}">${c.className}</option>`)
    .join("");
  $("filterSection").innerHTML += sections
    .map((s) => `<option value="${s.sectionName}">${s.sectionName}</option>`)
    .join("");

  const parentSearch = $("parentSearch");
  const parentSelect = $("parentSelect");
  const childrenSelect = $("childrenSelect");
  const filterClass = $("filterClass");
  const filterSection = $("filterSection");

  function filterChildren() {
    const cls = filterClass.value;
    const sec = filterSection.value;
    let list = children;
    if (cls) list = list.filter((c) => c.class === cls);
    if (sec) list = list.filter((c) => c.section === sec);
    childrenSelect.innerHTML = list
      .map(
        (c) =>
          `<option value="${c.id}">${c.name} (${c.class}-${c.section})</option>`
      )
      .join("");
  }

  filterChildren();
  filterClass.onchange = filterChildren;
  filterSection.onchange = filterChildren;

  parentSearch.oninput = () => {
    const q = parentSearch.value.toLowerCase().trim();
    if (q.length < 1) return (parentSelect.innerHTML = "");
    const matches = parents.filter((p) => p.name.startsWith(q));
    parentSelect.innerHTML = matches
      .map((p) => `<option value="${p.id}">${p.name}</option>`)
      .join("");
  };

  childrenSelect.onchange = () => {
    const selected = Array.from(childrenSelect.selectedOptions);
    const relationDiv = $("relationContainer");
    if (!selected.length) return (relationDiv.innerHTML = "");

    relationDiv.innerHTML = `
      <h4>Assign Relation</h4>
      ${selected
        .map(
          (s) => `
        <div style="margin-bottom:6px;">
          <label>${s.textContent}:</label>
          <select class="relationSelect" data-child="${s.value}">
            <option value="father">Father</option>
            <option value="mother">Mother</option>
            <option value="guardian">Guardian</option>
          </select>
        </div>
      `
        )
        .join("")}
    `;
  };

  $("linkBtn").onclick = async () => {
    const pid = parentSelect.value;
    if (!pid) return alert("Select a parent first.");

    const selectedChildren = Array.from(childrenSelect.selectedOptions);
    if (!selectedChildren.length)
      return alert("Select at least one child to link.");

    const relations = Array.from(
      document.querySelectorAll(".relationSelect")
    ).map((sel) => ({
      childId: sel.dataset.child,
      relation: sel.value,
    }));

    await window.dbAPI.addLink({
      id: Date.now().toString(),
      parentId: pid,
      children: relations,
    });

    alert("✅ Parent linked to children successfully!");
  };
}

/* ======= Recognition ======= */
async function loadRecognition() {
  $("modeContent").innerHTML = `<h3>Recognition Mode</h3>`;
  await startCamera();
}

/* ======= MENU ======= */
function setupMenu() {
  $("btnAdmin").onclick = loadRegisterParent;
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
  await buildMatcher();
  await updateCounts();
  setupMenu();
});
