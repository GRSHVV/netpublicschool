// db.js - IndexedDB wrapper for Users, Children, Relations, Audit
const DB_NAME = "FaceDB_v2";
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("Users")) {
        const store = d.createObjectStore("Users", { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
      }
      if (!d.objectStoreNames.contains("Children")) {
        d.createObjectStore("Children", { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains("Relations")) {
        d.createObjectStore("Relations", { autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("Audit")) {
        d.createObjectStore("Audit", { autoIncrement: true });
      }
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e);
  });
}

// Helpers for ID generation
function uid(prefix="U") {
  return prefix + Math.random().toString(36).slice(2,9);
}

/* ---------- Users ---------- */
// user = { id, name, role, descriptor: Array<number> }
async function saveUserObj(user) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("Users", "readwrite");
    tx.objectStore("Users").put(user);
    tx.oncomplete = () => res(user);
    tx.onerror = e => rej(e);
  });
}

async function saveUser(name, descriptor, role="Guardian") {
  const id = uid("U");
  const user = { id, name, role, descriptor: Array.from(descriptor) };
  return saveUserObj(user);
}

async function getAllUsers() {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("Users", "readonly");
    const req = tx.objectStore("Users").getAll();
    req.onsuccess = () => {
      const rows = req.result.map(u => ({ ...u, descriptor: new Float32Array(u.descriptor) }));
      res(rows);
    };
    req.onerror = e => rej(e);
  });
}

async function getUserByName(name) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("Users", "readonly");
    const idx = tx.objectStore("Users").index("name");
    const req = idx.get(name);
    req.onsuccess = () => res(req.result ? { ...req.result, descriptor: new Float32Array(req.result.descriptor) } : null);
    req.onerror = e => rej(e);
  });
}

async function getUserById(id) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction("Users").objectStore("Users").get(id);
    req.onsuccess = () => res(req.result ? { ...req.result, descriptor: new Float32Array(req.result.descriptor) } : null);
    req.onerror = e => rej(e);
  });
}

async function updateUserDescriptor(id, descriptor) {
  const u = await getUserById(id);
  if (!u) throw new Error("User not found");
  u.descriptor = Array.from(descriptor);
  return saveUserObj(u);
}

async function deleteUser(id) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(["Users","Relations"], "readwrite");
    tx.objectStore("Users").delete(id);
    // Also remove relations referencing this user
    const relStore = tx.objectStore("Relations");
    relStore.openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;
      const rec = cursor.value;
      if (rec.userId === id) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

/* ---------- Children ---------- */
// child = { id, name, class, section }
async function saveChildObj(child) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("Children", "readwrite");
    tx.objectStore("Children").put(child);
    tx.oncomplete = () => res(child);
    tx.onerror = e => rej(e);
  });
}

async function saveChild(name, cls, section) {
  const id = uid("C");
  const child = { id, name, class: cls, section };
  return saveChildObj(child);
}

async function getAllChildren() {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction("Children").objectStore("Children").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = e => rej(e);
  });
}

async function getChildById(id) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction("Children").objectStore("Children").get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = e => rej(e);
  });
}

async function deleteChild(id) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(["Children","Relations"], "readwrite");
    tx.objectStore("Children").delete(id);
    // remove relations referencing this child
    const relStore = tx.objectStore("Relations");
    relStore.openCursor().onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return;
      const rec = cursor.value;
      if (rec.childId === id) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

/* ---------- Relations ---------- */
// relation = { id(auto), userId, childId, label } label: Father/Mother/Guardian/Other
async function saveRelation(userId, childId, label="Guardian") {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("Relations", "readwrite");
    tx.objectStore("Relations").add({ userId, childId, label });
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

async function getRelationsByUser(userId) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const out = [];
    const req = db.transaction("Relations").objectStore("Relations").openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { res(out); return; }
      const v = cursor.value;
      if (v.userId === userId) out.push(v);
      cursor.continue();
    };
    req.onerror = e => rej(e);
  });
}

async function getRelationsByChild(childId) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const out = [];
    const req = db.transaction("Relations").objectStore("Relations").openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) { res(out); return; }
      const v = cursor.value;
      if (v.childId === childId) out.push(v);
      cursor.continue();
    };
    req.onerror = e => rej(e);
  });
}

async function getAllRelations() {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction("Relations").objectStore("Relations").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = e => rej(e);
  });
}

async function deleteRelation(key) {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("Relations", "readwrite");
    tx.objectStore("Relations").delete(key);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

/* ---------- Audit ---------- */
// saveAuditRecord(userId, childId, label (relation), timestamp)
async function saveAuditRecord(userId, childId, label) {
  if (!db) await openDB();
  const ts = new Date().toISOString();
  return new Promise((res, rej) => {
    const tx = db.transaction("Audit", "readwrite");
    tx.objectStore("Audit").add({ userId, childId, label, timestamp: ts });
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

async function getAllAudit() {
  if (!db) await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction("Audit").objectStore("Audit").getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = e => rej(e);
  });
}

// Export functions to global so other files can call them
window.dbAPI = {
  openDB, saveUser, saveUserObj, getAllUsers, getUserByName, getUserById, updateUserDescriptor, deleteUser,
  saveChild, saveChildObj, getAllChildren, getChildById, deleteChild,
  saveRelation, getRelationsByUser, getRelationsByChild, getAllRelations, deleteRelation,
  saveAuditRecord, getAllAudit
};
