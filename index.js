// index.js - main app logic (registration + recognition)
// IMPORTANT: models folder must be available at ./models (relative)

let currentMode = null;
let modelsLoaded = false;
let currentStream = null;
let adminDetectInterval = null;
let recognitionInterval = null;
let lastDetection = null;

// small helpers for status/log
function setStatus(msg) {
  const el = document.getElementById('statusMsg');
  if (el) el.textContent = msg;
  console.log('[STATUS]', msg);
}

function safeLog(...args) { console.log('[APP]', ...args); }

/* ===== Load models ===== */
async function loadModels() {
  try {
    setStatus('Loading face-api models...');
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('models')
    ]);
    modelsLoaded = true;
    setStatus('Models loaded');
    safeLog('Models loaded');
  } catch (err) {
    console.error('Model load error', err);
    setStatus('Error loading models. Check console.');
  }
}

/* ===== Start camera (optionally by deviceId) ===== */
async function startCamera(deviceId = null) {
  const statusVideo = document.getElementById('video-status');
  try {
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    }

    const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: { facingMode: 'environment' } };
    setStatus('Requesting camera...');
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;

    const video = document.getElementById('video');
    video.srcObject = stream;

    // ensure overlay matches video size when metadata is ready
    video.onloadedmetadata = () => {
      video.play().catch(()=>{});
      resizeOverlay();
      setStatus('Camera started');
      if (statusVideo) statusVideo.style.display = 'none';
    };

    // when dimension changes (e.g. orientation), update canvas
    video.addEventListener('resize', resizeOverlay);
  } catch (err) {
    console.error('startCamera error', err);
    setStatus('Camera start failed — allow permissions or use Start Camera button.');
    if (statusVideo) { statusVideo.style.display = 'block'; statusVideo.textContent = 'Camera paused'; }
  }
}

function resizeOverlay() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  if (!video || !canvas) return;
  canvas.width = video.videoWidth || canvas.clientWidth;
  canvas.height = video.videoHeight || canvas.clientHeight;
}

/* ===== Initialize DB + models + camera on load ===== */
document.addEventListener('DOMContentLoaded', async () => {
  setStatus('Opening DB...');
  try {
    await window.dbAPI.openDB();
    setStatus('DB opened');
  } catch (e) {
    console.error('DB open error', e);
    setStatus('IndexedDB error (see console).');
  }

  await loadModels();
  await startCamera();                 // try to start camera automatically
  switchMode('admin');                 // default to registration to show username input
});

/* ===== UI mode switching ===== */
function switchMode(mode) {
  currentMode = mode;
  safeLog('switchMode', mode);
  const container = document.getElementById('modeContent');
  clearDetectionLoops();

  if (mode === 'admin') {
    container.innerHTML = `
      <h3>Register User</h3>
      <div class="form-group"><label for="username">Name</label><input id="username" type="text" placeholder="Enter name"></div>
      <div class="form-group"><label for="role">Role</label>
        <select id="role"><option>Father</option><option>Mother</option><option>Guardian</option><option>Other</option></select>
      </div>
      <p style="font-size:0.9rem;color:#666">Show a live face or a printed photo to the camera. When face is detected and name entered, click Register.</p>
      <button id="registerBtn" disabled>Register</button>
      <h4 style="margin-top:12px">Registered Users</h4>
      <ul id="userList"></ul>
    `;

    // attach input listener
    const nameInput = document.getElementById('username');
    const registerBtn = document.getElementById('registerBtn');
    nameInput.addEventListener('input', () => {
      const namePresent = nameInput.value.trim().length > 0;
      registerBtn.disabled = !namePresent || !lastDetection;
    });

    registerBtn.addEventListener('click', registerFace);

    loadUsers();
    startLiveDetection();
    setStatus('Registration mode');
  } else if (mode === 'recognition') {
    container.innerHTML = `
      <h3>Recognition (Live Only)</h3>
      <p style="font-size:0.9rem;color:#666">This mode requires a live person (not uploaded photos). Move slightly to confirm liveness.</p>
      <div id="childSelection"></div>
    `;
    startRecognition();
    setStatus('Recognition mode');
  } else {
    container.innerHTML = '<p>Select a mode.</p>';
  }
}

/* ===== Clear detection loops ===== */
function clearDetectionLoops() {
  if (adminDetectInterval) { clearInterval(adminDetectInterval); adminDetectInterval = null; }
  if (recognitionInterval) { clearInterval(recognitionInterval); recognitionInterval = null; }
}

/* ===== Live detection for registration ===== */
function startLiveDetection() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  const ctx = canvas.getContext('2d');
  const registerBtn = document.getElementById('registerBtn');

  // safety
  if (!modelsLoaded) { setStatus('Models not loaded yet'); return; }
  if (!video) return;

  adminDetectInterval = setInterval(async () => {
    if (currentMode !== 'admin') return;
    if (!modelsLoaded || video.readyState < 2) return;

    // pick inputSize adaptively depending on last box size for better box accuracy
    let inputSize = 416;
    let scoreThreshold = 0.4;
    if (lastDetection) {
      const boxWidthRatio = lastDetection.detection.box.width / (video.videoWidth || 1);
      if (boxWidthRatio < 0.18) { scoreThreshold = 0.3; inputSize = 512; }
      else if (boxWidthRatio > 0.5) { scoreThreshold = 0.5; inputSize = 320; }
    }

    try {
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      // keep canvas size in sync
      resizeOverlay();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (detection && detection.detection) {
        // expand box a bit so face is nicely framed
        const box = detection.detection.box;
        const expand = 0.22;
        const newX = Math.max(0, box.x - box.width * expand / 2);
        const newY = Math.max(0, box.y - box.height * expand / 2);
        const newW = Math.min(canvas.width - newX, box.width * (1 + expand));
        const newH = Math.min(canvas.height - newY, box.height * (1 + expand));

        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 3;
        ctx.strokeRect(newX, newY, newW, newH);

        lastDetection = detection;

        const namePresent = (document.getElementById('username')?.value || '').trim().length > 0;
        registerBtn.disabled = !namePresent;
      } else {
        lastDetection = null;
        registerBtn.disabled = true;
      }
    } catch (err) {
      console.error('Detection error', err);
    }
  }, 350);
}

/* ===== Register face (save user) ===== */
async function registerFace() {
  try {
    const nameEl = document.getElementById('username');
    if (!nameEl) return alert('Name input missing');
    const name = nameEl.value.trim();
    const role = (document.getElementById('role')?.value) || 'Other';
    if (!name) return alert('Enter name');

    if (!lastDetection) return alert('No face detected. Show a face in the camera and try again.');

    const video = document.getElementById('video');

    // capture full-frame photo from the video element (works also if a photo is held to camera)
    const snap = document.createElement('canvas');
    snap.width = video.videoWidth || 640;
    snap.height = video.videoHeight || 480;
    const sctx = snap.getContext('2d');
    sctx.drawImage(video, 0, 0, snap.width, snap.height);
    const photoData = snap.toDataURL('image/png');

    const user = {
      id: Date.now().toString(),
      name,
      role,
      descriptor: Array.from(lastDetection.descriptor),
      photo: photoData
    };

    await window.dbAPI.addUser(user);
    setStatus(`Registered ${name}`);
    safeLog('User saved', user);

    // reset UI
    nameEl.value = '';
    lastDetection = null;
    loadUsers();
  } catch (err) {
    console.error('registerFace error', err);
    alert('Error saving user. See console.');
  }
}

/* ===== Load user list UI ===== */
async function loadUsers() {
  try {
    const users = await window.dbAPI.getAllUsers();
    const ul = document.getElementById('userList');
    if (!ul) return;
    ul.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      if (u.photo) {
        const img = document.createElement('img'); img.src = u.photo; img.width = 36; img.height = 36; img.style.objectFit = 'cover';
        left.appendChild(img);
      }
      const txt = document.createElement('div'); txt.style.marginLeft = '8px'; txt.textContent = `${u.name} (${u.role})`;
      left.appendChild(txt);
      li.appendChild(left);

      const del = document.createElement('button'); del.textContent = 'Delete'; del.className = 'danger';
      del.onclick = async () => { if (confirm(`Delete ${u.name}?`)) { await window.dbAPI.deleteUser(u.id); loadUsers(); } };
      li.appendChild(del);

      ul.appendChild(li);
    });
  } catch (err) {
    console.error('loadUsers error', err);
  }
}

/* ===== Recognition mode ===== */
function startRecognition() {
  if (!modelsLoaded) { setStatus('Models not loaded'); return; }
  const video = document.getElementById('video');
  const canvas = document.getElementById('overlay');
  const ctx = canvas.getContext('2d');
  // build matcher from known users
  window.dbAPI.getAllUsers().then(users => {
    if (!users || users.length === 0) { setStatus('No registered users'); return; }

    const labeled = users.map(u => new faceapi.LabeledFaceDescriptors(u.name, [new Float32Array(u.descriptor)]));
    const matcher = new faceapi.FaceMatcher(labeled, 0.6);

    recognitionInterval = setInterval(async () => {
      if (currentMode !== 'recognition') return;
      if (!modelsLoaded || video.readyState < 2) return;

      resizeOverlay();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      try {
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (detection) {
          const box = detection.detection.box;
          ctx.strokeStyle = 'green';
          ctx.lineWidth = 3;
          ctx.strokeRect(box.x, box.y, box.width, box.height);

          const match = matcher.findBestMatch(detection.descriptor);
          const sel = document.getElementById('childSelection');
          if (sel) sel.innerHTML = match.label !== 'unknown' ? `<p>Recognized: <strong>${match.label}</strong></p>` : `<p style="color:#c62828">Unrecognized</p>`;
        }
      } catch (err) {
        console.error('recognition error', err);
      }
    }, 500);
  }).catch(e => { console.error(e); setStatus('Error building matcher'); });
}

/* ===== Utility: stop intervals on unload ===== */
window.addEventListener('beforeunload', () => {
  try { if (currentStream) currentStream.getTracks().forEach(t => t.stop()); } catch(e){}
  clearDetectionLoops();
});
