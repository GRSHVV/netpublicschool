/* ============================================================
   Smart Pickup System - Main Frontend Logic
   ============================================================ */

let video, overlay, ctx;
let currentMode = "none";
let modelsLoaded = false;
let currentCameraId = null;
let allVideoDevices = [];
let lastDetection = null;

/* ============================================================
   Utility Helper
   ============================================================ */
function safeGet(id) {
  return document.getElementById(id);
}

/* ============================================================
   Initialization
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Initializing Smart Pickup App...");
  video = safeGet("video");
  overlay = safeGet("overlay");
  ctx = overlay.getContext("2d");

  if (window.dbAPI && typeof window.dbAPI.openDB === "function") {
    await window.dbAPI.openDB();
  }

  setupMenu();
  await updateStats();
  await loadFaceModels();
  await initCameraSystem(); // ✅ setup + populate + start default camera

  safeGet("statusMsg").textContent = "✅ Ready.";
});

/* ============================================================
   Load Face API Models
   ============================================================ */
async function loadFaceModels() {
  try {
    safeGet("statusMsg").textContent = "⏳ Loading AI models...";
    console.log("🧠 Loading face-api models...");

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("./models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("./models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("./models"),
    ]);

    modelsLoaded = true;
    console.log("✅ Models loaded successfully");
    safeGet("statusMsg").textContent = "Models ready for face detection.";
  } catch (err) {
    console.error("❌ Error loading models:", err);
    alert("Failed to load AI models. Ensure ./models folder is accessible.");
  }
}

/* ============================================================
   Menu Setup
   ============================================================ */
function setupMenu() {
  safeGet("btnAdmin").onclick = () => loadRegisterParent();
  safeGet("btnChild").onclick = () => loadRegisterChild();
  safeGet("btnClass").onclick = () => loadClassManager();
  safeGet("btnLink").onclick = () => loadLinkParentChild();
  safeGet("btnRecognition").onclick = () => loadRecognitionMode();

  const refreshBtn = safeGet("refreshStatsBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.style.transform = "rotate(360deg)";
      await updateStats();
      setTimeout(() => (refreshBtn.style.transform = "rotate(0deg)"), 400);
    });
  }
}

/* ============================================================
   Camera Initialization + Switch Handling
   ============================================================ */
async function populateCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    allVideoDevices = devices.filter((d) => d.kind === "videoinput");

    const select = safeGet("cameraSelect");
    if (!select) return;
    select.innerHTML = "";

    if (allVideoDevices.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No camera found";
      opt.disabled = true;
      select.appendChild(opt);
      safeGet("statusMsg").textContent = "❌ No camera detected.";
      return;
    }

    allVideoDevices.forEach((device, i) => {
      const opt = document.createElement("option");
      opt.value = device.deviceId;
      opt.textContent = device.label || `Camera ${i + 1}`;
      select.appendChild(opt);
    });

    select.onchange = async () => {
      const chosen = select.value;
      console.log("🔁 Switching to camera:", chosen);
      await startCamera(chosen);
    };

    if (!currentCameraId && allVideoDevices.length > 0) {
      currentCameraId = allVideoDevices[0].deviceId;
      select.value = currentCameraId;
    }
  } catch (err) {
    console.error("🚫 Camera enumeration error:", err);
    safeGet("statusMsg").textContent = "Unable to list cameras. Check permissions.";
  }
}

async function startCamera(deviceId = null) {
  try {
    // Stop old stream
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }

    if (!allVideoDevices.length) await populateCameraList();

    let constraints;
    if (deviceId) {
      currentCameraId = deviceId;
      constraints = {
        video: {
          deviceId: { ideal: deviceId },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
    } else {
      constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };
    }

    console.log("🎥 Starting camera with constraints:", constraints);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    safeGet("statusMsg").textContent = "📷 Camera active.";
    console.log("✅ Camera started successfully");

    if (modelsLoaded) detectFaces();
  } catch (err) {
    console.error("🚫 Camera start error:", err);
    let msg = "Camera error.";
    if (err.name === "NotAllowedError") msg = "Camera permission denied.";
    else if (err.name === "NotFoundError") msg = "No camera found.";
    else if (err.name === "NotReadableError") msg = "Camera busy.";
    else if (err.name === "OverconstrainedError") {
      msg = "Selected camera unavailable. Retrying...";
      setTimeout(() => startCamera(), 1500);
      return;
    }
    alert(msg);
    safeGet("statusMsg").textContent = msg;
  }
}

async function initCameraSystem() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (e) {
    console.warn("⚠️ Camera permission not granted yet.");
  }

  await populateCameraList();
  if (allVideoDevices.length > 0) {
    await startCamera(allVideoDevices[0].deviceId);
  } else {
    safeGet("statusMsg").textContent = "❌ No camera available.";
  }
}

/* ============================================================
   Face Detection Loop
   ============================================================ */
async function detectFaces() {
  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224 });
  setInterval(async () => {
    if (!modelsLoaded || !video || video.readyState !== 4) return;
    const detections = await faceapi
      .detectAllFaces(video, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const resized = faceapi.resizeResults(detections, {
      width: overlay.width,
      height: overlay.height,
    });
    faceapi.draw.drawDetections(overlay, resized);

    if (detections.length > 0) {
      lastDetection = detections[0];
      safeGet("registerBtn")?.removeAttribute("disabled");
    } else {
      safeGet("registerBtn")?.setAttribute("disabled", "true");
    }
  }, 500);
}

/* ============================================================
   Mode: Register Parent
   ============================================================ */
async function loadRegisterParent() {
  currentMode = "registerParent";
  safeGet("modeContent").innerHTML = `
    <h3>Register Parent</h3>
    <label>Parent Name:</label>
    <input type="text" id="username" placeholder="Enter parent name" />
    <label>Role:</label>
    <select id="role">
      <option value="father">Father</option>
      <option value="mother">Mother</option>
      <option value="guardian">Guardian</option>
    </select>
    <button id="registerBtn" disabled>Register Parent</button>
    <p style="font-size:0.9rem;color:gray;">Face must be detected before enabling Register.</p>
  `;

  safeGet("statusMsg").textContent = "Camera ready for registration...";
  await startCamera();

  safeGet("registerBtn").onclick = async () => {
    const name = safeGet("username").value.trim().toLowerCase();
    const role = safeGet("role").value.toLowerCase();
    if (!name) return alert("Please enter parent name.");
    if (!lastDetection) return alert("No face detected yet.");

    const desc = Array.from(lastDetection.descriptor);
    await window.dbAPI.addUser({
      id: Date.now().toString(),
      name,
      role,
      descriptor: desc,
    });
    alert("✅ Parent registered successfully!");
    await updateStats();
  };
}

/* ============================================================
   Mode: Register Child
   ============================================================ */
async function loadRegisterChild() {
  currentMode = "registerChild";
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();

  safeGet("modeContent").innerHTML = `
    <h3>Register Child</h3>
    <label>Child Name:</label>
    <input type="text" id="childName" placeholder="Enter child name" />
    <label>Class:</label>
    <select id="childClass">
      ${classes.map((c) => `<option value="${c.className}">${c.className}</option>`).join("")}
    </select>
    <label>Section:</label>
    <select id="childSection">
      ${sections.map((s) => `<option value="${s.sectionName}">${s.sectionName}</option>`).join("")}
    </select>
    <button id="addChildBtn">Register Child</button>
  `;

  safeGet("addChildBtn").onclick = async () => {
    const name = safeGet("childName").value.trim().toLowerCase();
    const cls = safeGet("childClass").value.toLowerCase();
    const sec = safeGet("childSection").value.toLowerCase();
    if (!name || !cls || !sec) return alert("Please fill all details.");
    await window.dbAPI.addChild({
      id: Date.now().toString(),
      name,
      class: cls,
      section: sec,
    });
    alert("✅ Child registered successfully!");
    safeGet("childName").value = "";
    await updateStats();
  };
}

/* ============================================================
   Manage Classes & Sections
   ============================================================ */
async function loadClassManager() {
  currentMode = "classManager";
  const content = `
    <h3>Manage Classes & Sections</h3>
    <div style="display:flex;gap:20px;flex-wrap:wrap;">
      <div style="flex:1;min-width:250px;">
        <h4>Add Class</h4>
        <label>Class Name:</label>
        <input type="text" id="className" placeholder="e.g., Grade 8" />
        <button id="addClassBtn">Add Class</button>
        <h4>Existing Classes</h4>
        <ul id="classList"></ul>
      </div>
      <div style="flex:1;min-width:250px;">
        <h4>Add Section</h4>
        <label>Section Name:</label>
        <input type="text" id="sectionName" placeholder="e.g., A, B" />
        <button id="addSectionBtn">Add Section</button>
        <h4>Existing Sections</h4>
        <ul id="sectionList"></ul>
      </div>
    </div>
  `;
  safeGet("modeContent").innerHTML = content;

  await refreshClassSectionLists();

  safeGet("addClassBtn").onclick = async () => {
    const name = safeGet("className").value.trim();
    if (!name) return alert("Please enter class name.");
    await window.dbAPI.addClassEntry({ id: Date.now().toString(), className: name });
    safeGet("className").value = "";
    await refreshClassSectionLists();
  };

  safeGet("addSectionBtn").onclick = async () => {
    const name = safeGet("sectionName").value.trim();
    if (!name) return alert("Please enter section name.");
    await window.dbAPI.addSectionEntry({ id: Date.now().toString(), sectionName: name });
    safeGet("sectionName").value = "";
    await refreshClassSectionLists();
  };
}

async function refreshClassSectionLists() {
  const classes = await window.dbAPI.getAllClasses();
  const sections = await window.dbAPI.getAllSections();
  safeGet("classList").innerHTML = classes
    .map((c) => `<li>${c.className}</li>`)
    .join("");
  safeGet("sectionList").innerHTML = sections
    .map((s) => `<li>${s.sectionName}</li>`)
    .join("");
}

/* ============================================================
   Link Parent & Child
   ============================================================ */
async function loadLinkParentChild() {
  currentMode = "link";
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();

  safeGet("modeContent").innerHTML = `
    <h3>Link Parent and Child</h3>
    <label>Select Parent:</label>
    <select id="parentSelect">
      ${parents.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}
    </select>
    <label>Select Child:</label>
    <select id="childSelect" multiple size="5">
      ${children.map((c) => `<option value="${c.id}">${c.name} (${c.class}-${c.section})</option>`).join("")}
    </select>
    <button id="linkBtn">Link Selected</button>
  `;

  safeGet("linkBtn").onclick = async () => {
    const parentId = safeGet("parentSelect").value;
    const selectedChildren = Array.from(safeGet("childSelect").selectedOptions).map(
      (o) => o.value
    );
    if (!parentId || selectedChildren.length === 0)
      return alert("Select one parent and at least one child.");
    for (const childId of selectedChildren) {
      await window.dbAPI.addLink({
        id: Date.now().toString() + Math.random(),
        parentId,
        childId,
      });
    }
    alert("✅ Linked successfully!");
  };
}

/* ============================================================
   Recognition Mode
   ============================================================ */
async function loadRecognitionMode() {
  currentMode = "recognition";
  safeGet("modeContent").innerHTML = `
    <h3>Recognition Mode</h3>
    <p>Show your face to identify registered parent.</p>
    <div id="recognitionStatus">Waiting for camera...</div>
  `;
  await startCamera();
}

/* ============================================================
   Stats Counter
   ============================================================ */
async function updateStats() {
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  safeGet("parentCount").textContent = parents.length;
  safeGet("childCount").textContent = children.length;
}
