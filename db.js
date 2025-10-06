/* ============================================================
   IndexedDB Utility for Smart Pickup System
   ============================================================ */

const DB_NAME = "SmartPickupDB";
const DB_VERSION = 5;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject("❌ DB open error: " + event.target.errorCode);
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      db = event.target.result;

      if (!db.objectStoreNames.contains("parents")) {
        const store = db.createObjectStore("parents", { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
      }

      if (!db.objectStoreNames.contains("children")) {
        const store = db.createObjectStore("children", { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
      }

      if (!db.objectStoreNames.contains("classes")) {
        const store = db.createObjectStore("classes", { keyPath: "id" });
        store.createIndex("className", "className", { unique: false });
      }

      if (!db.objectStoreNames.contains("sections")) {
        const store = db.createObjectStore("sections", { keyPath: "id" });
        store.createIndex("sectionName", "sectionName", { unique: false });
      }

      if (!db.objectStoreNames.contains("links")) {
        const store = db.createObjectStore("links", { keyPath: "id" });
        store.createIndex("parentId", "parentId", { unique: false });
      }

      if (!db.objectStoreNames.contains("audits")) {
        const store = db.createObjectStore("audits", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
      }
    };
  });
}

/* ============================================================
   PARENT (USER) OPERATIONS
   ============================================================ */

async function addUser(user) {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("parents", "readwrite");
    const store = tx.objectStore("parents");
    store.add(user);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function getAllUsers() {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("parents", "readonly");
    const store = tx.objectStore("parents");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e);
  });
}

/* ============================================================
   CHILD OPERATIONS
   ============================================================ */

async function addChild(child) {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("children", "readwrite");
    const store = tx.objectStore("children");
    store.add(child);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function getAllChildren() {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("children", "readonly");
    const store = tx.objectStore("children");
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e);
  });
}

/* ============================================================
   CLASS OPERATIONS (no duplicates allowed)
   ============================================================ */

async function addClassEntry(classObj) {
  const dbConn = await openDB();
  const existing = await getAllClasses();
  const exists = existing.some(
    (c) => c.className.trim().toLowerCase() === classObj.className.trim().toLowerCase()
  );
  if (exists) {
    alert("⚠️ Class already exists!");
    return false;
  }

  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("classes", "readwrite");
    tx.objectStore("classes").add(classObj);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function getAllClasses() {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("classes", "readonly");
    const store = tx.objectStore("classes");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

/* ============================================================
   SECTION OPERATIONS (no duplicates allowed)
   ============================================================ */

async function addSectionEntry(sectionObj) {
  const dbConn = await openDB();
  const existing = await getAllSections();
  const exists = existing.some(
    (s) => s.sectionName.trim().toLowerCase() === sectionObj.sectionName.trim().toLowerCase()
  );
  if (exists) {
    alert("⚠️ Section already exists!");
    return false;
  }

  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("sections", "readwrite");
    tx.objectStore("sections").add(sectionObj);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function getAllSections() {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("sections", "readonly");
    const store = tx.objectStore("sections");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

/* ============================================================
   LINK OPERATIONS
   ============================================================ */

async function addLink(linkObj) {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("links", "readwrite");
    tx.objectStore("links").add(linkObj);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function getAllLinks() {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("links", "readonly");
    const store = tx.objectStore("links");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e);
  });
}

/* ============================================================
   AUDIT OPERATIONS
   ============================================================ */

async function addAudit(record) {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("audits", "readwrite");
    tx.objectStore("audits").add(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = (e) => reject(e);
  });
}

async function getLastAudits(limit = 10) {
  const dbConn = await openDB();
  return new Promise((resolve, reject) => {
    const tx = dbConn.transaction("audits", "readonly");
    const store = tx.objectStore("audits");
    const req = store.getAll();
    req.onsuccess = () => {
      const result = req.result.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
      resolve(result);
    };
    req.onerror = (e) => reject(e);
  });
}

/* ============================================================
   EXPOSE FUNCTIONS
   ============================================================ */

window.dbAPI = {
  openDB,
  addUser,
  getAllUsers,
  addChild,
  getAllChildren,
  addClassEntry,
  getAllClasses,
  addSectionEntry,
  getAllSections,
  addLink,
  getAllLinks,
  addAudit,
  getLastAudits,
};
