"use strict";

(() => {
  const DB_NAME = "FacePickupDB";
  const DB_VERSION = 6;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        db = e.target.result;
        if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "id" });
        if (!db.objectStoreNames.contains("children")) db.createObjectStore("children", { keyPath: "id" });
        if (!db.objectStoreNames.contains("classes")) db.createObjectStore("classes", { keyPath: "id" });
        if (!db.objectStoreNames.contains("sections")) db.createObjectStore("sections", { keyPath: "id" });
        if (!db.objectStoreNames.contains("links")) db.createObjectStore("links", { keyPath: "id" });
        if (!db.objectStoreNames.contains("audits")) db.createObjectStore("audits", { keyPath: "id" });
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e);
    });
  }

  function tx(storeNames, mode = "readonly") {
    const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = db.transaction(stores, mode);
    return tx;
  }

  function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = tx(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function put(storeName, obj) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName, "readwrite").objectStore(storeName);
      const req = store.put(obj);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function del(storeName, key) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName, "readwrite").objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /* API functions */
  async function addUser(u) {
    u.name = (u.name || "").trim().toLowerCase();
    // no duplicate by exact name
    const users = await getAll("users");
    if (users.some(x => x.name === u.name)) throw new Error("Parent with same name exists");
    return put("users", u);
  }
  async function getAllUsers() { return getAll("users"); }

  async function addChild(c) {
    c.name = (c.name || "").trim().toLowerCase();
    c.class = (c.class || "").trim().toLowerCase();
    c.section = (c.section || "").trim().toLowerCase();
    return put("children", c);
  }
  async function getAllChildren() { return getAll("children"); }

  async function addClassEntry(entry) {
    entry.className = (entry.className || "").trim().toLowerCase();
    if (!entry.className) throw new Error("Empty class");
    const existing = await getAll("classes");
    if (existing.some(x => x.className === entry.className)) return;
    return put("classes", entry);
  }
  async function getAllClasses() { return getAll("classes"); }

  async function addSectionEntry(entry) {
    entry.sectionName = (entry.sectionName || "").trim().toLowerCase();
    if (!entry.sectionName) throw new Error("Empty section");
    const existing = await getAll("sections");
    if (existing.some(x => x.sectionName === entry.sectionName)) return;
    return put("sections", entry);
  }
  async function getAllSections() { return getAll("sections"); }

  async function addLink(link) {
    // normalize: children entries should be [{childId, relation}, ...]
    link.children = Array.isArray(link.children) ? link.children.map(ch => ({ childId: ch.childId, relation: (ch.relation||"guardian").trim().toLowerCase() })) : [];
    return put("links", link);
  }
  async function getAllLinks() { return getAll("links"); }

  async function addAudit(a) {
    return put("audits", a);
  }
  async function getAllAudits() { return getAll("audits"); }

  /* delete helpers */
  async function deleteClass(id) { return del("classes", id); }
  async function deleteSection(id) { return del("sections", id); }
  async function deleteUser(id) { return del("users", id); }
  async function deleteChild(id) { return del("children", id); }
  async function deleteLink(id) { return del("links", id); }

  /* expose */
  window.dbAPI = {
    openDB,
    _getDB: () => db,
    addUser, getAllUsers,
    addChild, getAllChildren,
    addClassEntry, getAllClasses,
    addSectionEntry, getAllSections,
    addLink, getAllLinks,
    addAudit, getAllAudits,
    deleteClass, deleteSection, deleteUser, deleteChild, deleteLink
  };
})();
