"use strict";

window.dbAPI = (() => {
  const DB_NAME = "FacePickupDB";
  const DB_VERSION = 5;
  let db;

  /* ======= OPEN DB ======= */
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
        if (!db.objectStoreNames.contains("links")) {
          db.createObjectStore("links", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("classes")) {
          db.createObjectStore("classes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sections")) {
          db.createObjectStore("sections", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("audits")) {
          db.createObjectStore("audits", { keyPath: "id" });
        }
      };

      req.onsuccess = (e) => {
        db = e.target.result;
        console.log("✅ IndexedDB opened successfully");
        resolve();
      };

      req.onerror = (e) => reject(e);
    });
  }

  /* ======= GENERIC HELPERS ======= */
  function getStore(name, mode = "readonly") {
    return db.transaction(name, mode).objectStore(name);
  }

  function getAll(name) {
    return new Promise((resolve) => {
      const req = getStore(name).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }

  async function addRecord(name, record) {
    return new Promise((resolve, reject) => {
      const store = getStore(name, "readwrite");
      const req = store.add(record);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  }

  /* ======= USERS ======= */
  async function addUser(user) {
    user.name = user.name.trim().toLowerCase();
    await addRecord("users", user);
  }

  async function getAllUsers() {
    return await getAll("users");
  }

  /* ======= CHILDREN ======= */
  async function addChild(child) {
    child.name = child.name.trim().toLowerCase();
    child.class = child.class.trim().toLowerCase();
    child.section = child.section.trim().toLowerCase();
    await addRecord("children", child);
  }

  async function getAllChildren() {
    return await getAll("children");
  }

  /* ======= CLASSES ======= */
  async function addClassEntry(entry) {
    entry.className = entry.className.trim().toLowerCase();
    const existing = await getAll("classes");
    const duplicate = existing.some(
      (c) => c.className.toLowerCase() === entry.className
    );
    if (duplicate) {
      alert("⚠️ Class already exists!");
      return;
    }
    await addRecord("classes", entry);
  }

  async function getAllClasses() {
    return await getAll("classes");
  }

  /* ======= SECTIONS ======= */
  async function addSectionEntry(entry) {
    entry.sectionName = entry.sectionName.trim().toLowerCase();
    const existing = await getAll("sections");
    const duplicate = existing.some(
      (s) => s.sectionName.toLowerCase() === entry.sectionName
    );
    if (duplicate) {
      alert("⚠️ Section already exists!");
      return;
    }
    await addRecord("sections", entry);
  }

  async function getAllSections() {
    return await getAll("sections");
  }

  /* ======= LINKS ======= */
  async function addLink(link) {
    await addRecord("links", link);
  }

  async function getAllLinks() {
    return await getAll("links");
  }

  /* ======= AUDITS ======= */
  async function addAudit(audit) {
    await addRecord("audits", audit);
  }

  async function getAllAudits() {
    return await getAll("audits");
  }

  /* ======= EXPORT ======= */
  return {
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
})();
