function switchMode(mode) {
  currentMode = mode;
  const c = document.getElementById("modeContent");

  if (mode === "admin") {
    c.innerHTML = `
      <h3>Register User</h3>
      <div class="scroll-area">
        <div class="form-group"><label>Name</label><input id="username"></div>
        <div class="form-group"><label>Role</label>
          <select id="role"><option>Father</option><option>Mother</option><option>Guardian</option><option>Other</option></select>
        </div>
        <h4>Registered Users</h4><ul id="userList"></ul>
      </div>
      <div class="actions">
        <button id="captureBtn" class="capture disabled" onclick="captureUser()" disabled>No Face Detected</button>
      </div>
    `;
    loadUsers();
    startAdminDetection();
  }

  if (mode === "children") {
    c.innerHTML = `
      <h3>Manage Children</h3>
      <div class="scroll-area">
        <div class="form-group"><label>Child Name</label><input id="childName"></div>
        <div class="form-group"><label>Class</label><input id="childClass"></div>
        <div class="form-group"><label>Section</label><input id="childSection"></div>
        <h4>Children</h4><ul id="childrenList"></ul>
      </div>
      <div class="actions">
        <button onclick="addChild()">Add</button>
      </div>
    `;
    loadChildren();
  }

  if (mode === "relations") {
    c.innerHTML = `
      <h3>Manage Relations</h3>
      <div class="scroll-area">
        <div class="form-group"><label>User</label><select id="userSelect"></select></div>
        <div class="form-group"><label>Child</label><select id="childSelect"></select></div>
        <div class="form-group"><label>Relation</label>
          <select id="relationLabel"><option>Father</option><option>Mother</option><option>Guardian</option><option>Other</option></select>
        </div>
        <h4>Relations</h4><ul id="relationList"></ul>
      </div>
      <div class="actions">
        <button onclick="linkRelation()">Link</button>
      </div>
    `;
    loadRelations();
  }

  if (mode === "recognition") {
    c.innerHTML = `
      <h3>Recognition</h3>
      <div class="scroll-area" id="childSelection"></div>
      <div class="actions">
        <button onclick="submitPickup()">Submit Pickup</button>
      </div>
    `;
    startRecognition();
  }
}
