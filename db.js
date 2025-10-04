// db.js — IndexedDB for Parents, Children, and Parent-Child Links

window.dbAPI = {
  db: null,

  /* ===== Initialize / Open Database ===== */
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("FacePickupDB", 3);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create stores if not existing
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("children")) {
          db.createObjectStore("children", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("links")) {
          db.createObjectStore("links", { keyPath: "parentId" });
        }
        console.log("Database upgraded / created.");
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log("✅ Database opened successfully");
        resolve();
      };

      request.onerror = (event) => {
        console.error("❌ IndexedDB error:", event.target.error);
        reject(event.target.error);
      };
    });
  },

  /* ===== User (Parent) Operations ===== */
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

  async deleteUser(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("users", "readwrite");
      tx.objectStore("users").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  /* ===== Child Operations ===== */
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

  async deleteChild(id) {
    return new Promise((resolve) => {
      const tx = this.db.transaction("children", "readwrite");
      tx.objectStore("children").delete(id);
      tx.oncomplete = () => resolve();
    });
  },

  /* ===== Parent ↔ Children Links ===== */
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

  /* ===== Utility: Clear All (for testing/reset) ===== */
  async clearAll() {
    const stores = ["users", "children", "links"];
    for (const s of stores) {
      const tx = this.db.transaction(s, "readwrite");
      tx.objectStore(s).clear();
    }
    console.log("✅ Cleared all data");
  },
};
