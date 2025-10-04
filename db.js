// db.js — Full IndexedDB implementation for Smart Pickup System
// Supports: Parents, Children, Links, Classes, Sections

window.dbAPI = {
  db: null,

  /* ====== Initialize or Upgrade Database ====== */
  async openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("FacePickupDB", 4);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Parent data store (with face descriptor)
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }

        // Children data store
        if (!db.objectStoreNames.contains("children")) {
          db.createObjectStore("children", { keyPath: "id" });
        }

        // Parent–Child link store
        if (!db.objectStoreNames.contains("links")) {
          db.createObjectStore("links", { keyPath: "parentId" });
        }

        // Classes data store
        if (!db.objectStoreNames.contains("classes")) {
          db.createObjectStore("classes", { keyPath: "id" });
        }

        // Sections data store
        if (!db.objectStoreNames.contains("sections")) {
          db.createObjectStore("sections", { keyPath: "id" });
        }

        console.log("✅ Database upgraded or created successfully.");
      };

      req.onsuccess = (event) => {
        this.db = event.target.result;
        console.log("✅ Database opened successfully");
        resolve();
      };

      req.onerror = (event) => {
        console.error("❌ Database error:", event.target.error);
        reject(event.target.error);
      };
    });
  },

  /* ============================================================
   *                     USERS (PARENTS)
   * ============================================================ */
  async addUser(user) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("users", "readwrite");
      const store = tx.objectStore("users");
      const req = store.put(user);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  },

  async getAllUsers() {
    return new Promise((resolve) => {
      const tx = this.db.transaction("users", "readonly");
      const store = tx.objectStore("users");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  },

  async getUserById(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("users", "readonly");
      const store = tx.objectStore("users");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
    });
  },

  async deleteUser(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("users", "readwrite");
      tx.objectStore("users").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  /* ============================================================
   *                     CHILDREN
   * ============================================================ */
  async addChild(child) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("children", "readwrite");
      const store = tx.objectStore("children");
      const req = store.put(child);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  },

  async getAllChildren() {
    return new Promise((resolve) => {
      const tx = this.db.transaction("children", "readonly");
      const store = tx.objectStore("children");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  },

  async getChildById(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("children", "readonly");
      const store = tx.objectStore("children");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
    });
  },

  async deleteChild(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("children", "readwrite");
      tx.objectStore("children").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  /* ============================================================
   *                     LINKS (Parent ↔ Children)
   * ============================================================ */
  async linkParentChildren(parentId, childrenIds) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("links", "readwrite");
      const store = tx.objectStore("links");
      const linkObj = { parentId, childrenIds };
      const req = store.put(linkObj);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e);
    });
  },

  async getAllLinks() {
    return new Promise((resolve) => {
      const tx = this.db.transaction("links", "readonly");
      const store = tx.objectStore("links");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  },

  async getLinksByParent(parentId) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("links", "readonly");
      const store = tx.objectStore("links");
      const req = store.get(parentId);
      req.onsuccess = () => resolve(req.result || null);
    });
  },

  async deleteLink(parentId) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("links", "readwrite");
      tx.objectStore("links").delete(parentId);
      tx.oncomplete = () => resolve();
    });
  },

  /* ============================================================
   *                     CLASSES
   * ============================================================ */
  async addClass(name) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("classes", "readwrite");
      const store = tx.objectStore("classes");
      const id = Date.now().toString();
      const req = store.put({ id, name });
      req.onsuccess = () => resolve(id);
      req.onerror = (e) => reject(e);
    });
  },

  async getAllClasses() {
    return new Promise((resolve) => {
      const tx = this.db.transaction("classes", "readonly");
      const store = tx.objectStore("classes");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  },

  async deleteClass(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("classes", "readwrite");
      tx.objectStore("classes").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  /* ============================================================
   *                     SECTIONS
   * ============================================================ */
  async addSection(name) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("sections", "readwrite");
      const store = tx.objectStore("sections");
      const id = Date.now().toString();
      const req = store.put({ id, name });
      req.onsuccess = () => resolve(id);
      req.onerror = (e) => reject(e);
    });
  },

  async getAllSections() {
    return new Promise((resolve) => {
      const tx = this.db.transaction("sections", "readonly");
      const store = tx.objectStore("sections");
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
    });
  },

  async deleteSection(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("sections", "readwrite");
      tx.objectStore("sections").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  /* ============================================================
   *                     UTILITIES
   * ============================================================ */
  async clearAll() {
    const stores = ["users", "children", "links", "classes", "sections"];
    for (const s of stores) {
      const tx = this.db.transaction(s, "readwrite");
      tx.objectStore(s).clear();
    }
    console.log("✅ Cleared all data stores.");
  },
};
