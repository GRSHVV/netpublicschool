"use strict";

const DB_NAME = "FacePickupDB";
const DB_VERSION = 4;

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
  getAllAudits,
};

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("users"))
        db.createObjectStore("users", { keyPath: "id" });
      if (!db.objectStoreNames.contains("children"))
        db.createObjectStore("children", { keyPath: "id" });
      if (!db.objectStoreNames.contains("classes"))
        db.createObjectStore("classes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sections"))
        db.createObjectStore("sections", { keyPath: "id" });
      if (!db.objectStoreNames.contains("links"))
        db.createObjectStore("links", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audits"))
        db.createObjectStore("audits", { keyPath: "id" });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txStore(store, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const st = tx.objectStore(store);
    const req = fn(st);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* USERS */
async function addUser(u) {
  return txStore("users", "readwrite", (st) => st.put(u));
}
async function getAllUsers() {
  return txStore("users", "readonly", (st) => st.getAll());
}

/* CHILDREN */
async function addChild(c) {
  return txStore("children", "readwrite", (st) => st.put(c));
}
async function getAllChildren() {
  return txStore("children", "readonly", (st) => st.getAll());
}

/* CLASSES */
async function addClassEntry(c) {
  const existing = await getAllClasses();
  if (existing.some((x) => x.className === c.className)) return;
  return txStore("classes", "readwrite", (st) => st.put(c));
}
async function getAllClasses() {
  return txStore("classes", "readonly", (st) => st.getAll());
}

/* SECTIONS */
async function addSectionEntry(s) {
  const existing = await getAllSections();
  if (existing.some((x) => x.sectionName === s.sectionName)) return;
  return txStore("sections", "readwrite", (st) => st.put(s));
}
async function getAllSections() {
  return txStore("sections", "readonly", (st) => st.getAll());
}

/* LINKS (Parent → Child with relation) */
async function addLink(l) {
  return txStore("links", "readwrite", (st) => st.put(l));
}
async function getAllLinks() {
  return txStore("links", "readonly", (st) => st.getAll());
}

/* AUDITS */
async function addAudit(a) {
  return txStore("audits", "readwrite", (st) => st.put(a));
}
async function getAllAudits() {
  return txStore("audits", "readonly", (st) => st.getAll());
}
