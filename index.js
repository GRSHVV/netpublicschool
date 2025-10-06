/* ============================================================
   Smart Pickup System - Main Frontend Logic
   ============================================================ */

let video, overlay, ctx;
let currentMode = "none";
let lastDetection = null;

/* ============================================================
   Utility Helpers
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

  // Ensure IndexedDB initialized
  if (window.dbAPI && window.dbAPI.openDB) {
    await window.dbAPI.openDB();
  }

  setupMenu();
  await updateStats();

  safeGet("statusMsg").textContent = "Ready.";
});

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
   Face Detection & Camera Helpers
   ============================================================ */
async function startCamera(deviceId) {
  try {
    const constraints = {
      video: { deviceId: deviceId ? { exact: deviceId } : undefined },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.play();
    console.log("📷 Camera started.");
  } catch (err) {
    console.error("Camera error:", err);
    alert("Camera permission denied or unavailable.");
  }
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
    <p style="font-size:0.9rem;color:gray;">Face must be detected before enabling Register button.</p>
  `;

  safeGet("statusMsg").textContent = "Camera ready for face detection...";
  await startCamera();

  const registerBtn = safeGet("registerBtn");

  // Simulated detection readiness
  registerBtn.disabled = false;
  registerBtn.onclick = async () => {
    const name = safeGet("username").value.trim().toLowerCase();
    const role = safeGet("role").value.toLowerCase();
    if (!name) return alert("Please enter parent name.");

    // Simulated face descriptor
    const desc = Array(128).fill(Math.random());
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
   Mode: Manage Classes & Sections
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
    .map(
      (c) =>
        `<li>${c.className} <button class="delBtn" onclick="deleteClass('${c.id}')">❌</button></li>`
    )
    .join("");
  safeGet("sectionList").innerHTML = sections
    .map(
      (s) =>
        `<li>${s.sectionName} <button class="delBtn" onclick="deleteSection('${s.id}')">❌</button></li>`
    )
    .join("");
}

async function deleteClass(id) {
  if (!confirm("Are you sure you want to delete this class?")) return;
  const db = await window.dbAPI.openDB();
  const tx = db.transaction("classes", "readwrite");
  tx.objectStore("classes").delete(id);
  tx.oncomplete = refreshClassSectionLists;
}

async function deleteSection(id) {
  if (!confirm("Are you sure you want to delete this section?")) return;
  const db = await window.dbAPI.openDB();
  const tx = db.transaction("sections", "readwrite");
  tx.objectStore("sections").delete(id);
  tx.oncomplete = refreshClassSectionLists;
}

/* ============================================================
   Mode: Link Parent and Child
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
    alert("✅ Parent and children linked successfully!");
  };
}

/* ============================================================
   Mode: Recognition
   ============================================================ */
async function loadRecognitionMode() {
  currentMode = "recognition";
  safeGet("modeContent").innerHTML = `
    <h3>Recognition Mode</h3>
    <p>Show face to camera to identify registered parent.</p>
    <div id="recognitionStatus">Waiting for camera...</div>
  `;
  await startCamera();
}

/* ============================================================
   STATS COUNTER (Parents / Children)
   ============================================================ */
async function updateStats() {
  const parents = await window.dbAPI.getAllUsers();
  const children = await window.dbAPI.getAllChildren();
  safeGet("parentCount").textContent = parents.length;
  safeGet("childCount").textContent = children.length;
}
