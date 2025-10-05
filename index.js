// index.js — Smart Pickup System (Final Version with Enlarged Recognition Status)
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
   RECOGNITION MODE (Larger Font & Highlighted)
===================================================== */
function renderRecognition(content) {
  content.innerHTML = `
    <h3>Recognition</h3>
    <div id="recognitionResult" class="result-box" 
      style="font-size: 1.3rem; font-weight: 600; padding: 15px; border-radius: 10px;
      background: #f9fafb; color: #222; min-height: 120px;">
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
    setStatus("No registered parents.");
    safeGet("recognitionResult").innerHTML = "<p>No registered parents</p>";
    return;
  }
  const labeled = users.map(
    (u) => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)])
  );
  const matcher = new faceapi.FaceMatcher(labeled, 0.6);
  const v = safeGet("video");
  const o = safeGet("overlay");
  const resultBox = safeGet("recognitionResult");

  recognitionInterval = setInterval(async () => {
    if (!modelsLoaded || !v.videoWidth) return;
    const det = await faceapi
      .detectSingleFace(v, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.32 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    const ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    if (!det) return;

    const best = matcher.findBestMatch(det.descriptor);
    let color = best.label === "unknown" ? "red" : "lime";
    drawAlignedDetections(v, o, [det], color);

    if (best.label === "unknown") {
      resultBox.innerHTML = `
        <div style="background:#fee2e2;padding:15px;border-radius:10px;color:#b91c1c;">
          <h2>❌ Unrecognized Face</h2>
          <p>Please check registration.</p>
        </div>`;
      return;
    }

    const parent = users.find((u) => u.name === best.label);
    const link = links.find((l) => l.parentId === parent?.id);
    const kidsHtml = (link?.childrenIds || [])
      .map((cid) => {
        const c = children.find((ch) => ch.id === cid);
        return c
          ? `<li style="font-size:1.2rem;line-height:1.6;">👧 ${c.name} (${c.class}-${c.section})</li>`
          : "";
      })
      .join("");

    resultBox.innerHTML = `
      <div style="background:#dcfce7;padding:15px;border-radius:10px;color:#166534;">
        <h2>✅ Recognized: ${best.label}</h2>
        ${
          kidsHtml
            ? `<h3>Linked Children:</h3><ul style="margin-top:5px;">${kidsHtml}</ul>`
            : "<p>No linked children found.</p>"
        }
      </div>`;
  }, 350);
}

window.addEventListener("beforeunload", () => {
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  if (adminDetectInterval) clearInterval(adminDetectInterval);
  if (recognitionInterval) clearInterval(recognitionInterval);
});
