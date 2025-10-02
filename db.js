let db;
const DB_NAME = "faceApp";
const DB_VERSION = 1;

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("children")) {
        db.createObjectStore("children", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("relations")) {
        db.createObjectStore("relations", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("audit")) {
        db.createObjectStore("audit", { keyPath: "id" });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    req.onerror = (e) => reject(e);
  });
}

/* Users */
async function addUser(user) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readwrite");
    tx.objectStore("users").put(user);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

async function getAllUsers() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readonly");
    const req = tx.objectStore("users").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

async function deleteUser(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("users", "readwrite");
    tx.objectStore("users").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

/* Children */
async function addChild(child) {
  return new Promise(async (resolve, reject) => {
    const existing = await getAllChildren();
    if (existing.length >= 1000) {
      alert("❌ Maximum children limit (1000) reached. Cannot add more.");
      return reject("Max children limit reached");
    }

    const tx = db.transaction("children", "readwrite");
    tx.objectStore("children").put(child);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

async function getAllChildren() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("children", "readonly");
    const req = tx.objectStore("children").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e);
  });
}

async function deleteChild(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("children", "readwrite");
    tx.objectStore("children").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e);
  });
}

window.dbAPI = {
  openDB,
  addUser,
  getAllUsers,
  deleteUser,
  addChild,
  getAllChildren,
  deleteChild
};
