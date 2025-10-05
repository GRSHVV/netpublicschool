// db.js — Smart Pickup System IndexedDB Manager (Version 6)
// ==========================================================
// Handles all data persistence: parents, children, classes, sections, links.

window.dbAPI = {
  db: null,

  /* =====================================================
     OPEN DATABASE
  ===================================================== */
  async openDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("FacePickupDB", 6);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("children")) {
          db.createObjectStore("children", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("classes")) {
          db.createObjectStore("classes", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sections")) {
          db.createObjectStore("sections", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("links")) {
          db.createObjectStore("links", { keyPath: "parentId" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("IndexedDB open error:", event.target.error);
        reject(event.target.error);
      };
    });
  },

  /* =====================================================
     USERS (Parents)
  ===================================================== */
  async addUser(user) {
    await this.openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("users", "readwrite");
        tx.objectStore("users").put(user);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
      } catch (e) {
        console.error("addUser failed:", e);
        reject(e);
      }
    });
  },

  async getAllUsers() {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("users", "readonly");
        const req = tx.objectStore("users").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        console.error("getAllUsers failed:", e);
        resolve([]);
      }
    });
  },

  async getUserById(id) {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("users", "readonly");
        const req = tx.objectStore("users").get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        console.error("getUserById failed:", e);
        resolve(null);
      }
    });
  },

  async deleteUser(id) {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("users", "readwrite");
        tx.objectStore("users").delete(id);
        tx.oncomplete = () => resolve();
      } catch (e) {
        console.error("deleteUser failed:", e);
        resolve();
      }
    });
  },

  /* =====================================================
     CHILDREN
  ===================================================== */
  async addChild(child) {
    await this.openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("children", "readwrite");
        tx.objectStore("children").put(child);
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e);
      } catch (e) {
        console.error("addChild failed:", e);
        reject(e);
      }
    });
  },

  async getAllChildren() {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("children", "readonly");
        const req = tx.objectStore("children").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        console.error("getAllChildren failed:", e);
        resolve([]);
      }
    });
  },

  async getChildById(id) {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("children", "readonly");
        const req = tx.objectStore("children").get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        console.error("getChildById failed:", e);
        resolve(null);
      }
    });
  },

  async deleteChild(id) {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("children", "readwrite");
        tx.objectStore("children").delete(id);
        tx.oncomplete = () => resolve();
      } catch (e) {
        console.error("deleteChild failed:", e);
        resolve();
      }
    });
  },

  /* =====================================================
     CLASSES
  ===================================================== */
  async addClass(name) {
    await this.openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("classes", "readwrite");
        const store = tx.objectStore("classes");
        const id = Date.now().toString();
        const req = store.put({ id, name });
        req.onsuccess = () => resolve(id);
        req.onerror = (e) => reject(e);
      } catch (e) {
        console.error("addClass failed:", e);
        reject(e);
      }
    });
  },

  async getAllClasses() {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("classes", "readonly");
        const req = tx.objectStore("classes").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        console.error("getAllClasses failed:", e);
        resolve([]);
      }
    });
  },

  async deleteClass(id) {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("classes", "readwrite");
        tx.objectStore("classes").delete(id);
        tx.oncomplete = () => resolve();
      } catch (e) {
        console.error("deleteClass failed:", e);
        resolve();
      }
    });
  },

  /* =====================================================
     SECTIONS
  ===================================================== */
  async addSection(name) {
    await this.openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("sections", "readwrite");
        const store = tx.objectStore("sections");
        const id = Date.now().toString();
        const req = store.put({ id, name });
        req.onsuccess = () => resolve(id);
        req.onerror = (e) => reject(e);
      } catch (e) {
        console.error("addSection failed:", e);
        reject(e);
      }
    });
  },

  async getAllSections() {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("sections", "readonly");
        const req = tx.objectStore("sections").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        console.error("getAllSections failed:", e);
        resolve([]);
      }
    });
  },

  async deleteSection(id) {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("sections", "readwrite");
        tx.objectStore("sections").delete(id);
        tx.oncomplete = () => resolve();
      } catch (e) {
        console.error("deleteSection failed:", e);
        resolve();
      }
    });
  },

  /* =====================================================
     LINKS (Parent → Children)
  ===================================================== */
  async linkParentChildren(parentId, childIds) {
    await this.openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("links", "readwrite");
        const store = tx.objectStore("links");
        const req = store.get(parentId);

        req.onsuccess = () => {
          const existing = req.result;
          if (existing) {
            const merged = Array.from(
              new Set([...(existing.childrenIds || []), ...childIds])
            );
            existing.childrenIds = merged;
            store.put(existing).onsuccess = () => resolve();
          } else {
            store.put({ parentId, childrenIds: childIds }).onsuccess = () =>
              resolve();
          }
        };
        req.onerror = (e) => reject(e);
      } catch (e) {
        console.error("linkParentChildren failed:", e);
        reject(e);
      }
    });
  },

  async unlinkChild(parentId, childId) {
    await this.openDB();
    return new Promise((resolve, reject) => {
      try {
        const tx = this.db.transaction("links", "readwrite");
        const store = tx.objectStore("links");
        const req = store.get(parentId);
        req.onsuccess = () => {
          const link = req.result;
          if (!link) return resolve();
          link.childrenIds = (link.childrenIds || []).filter((c) => c !== childId);
          store.put(link).onsuccess = () => resolve();
        };
        req.onerror = (e) => reject(e);
      } catch (e) {
        console.error("unlinkChild failed:", e);
        reject(e);
      }
    });
  },

  async getAllLinks() {
    await this.openDB();
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction("links", "readonly");
        const req = tx.objectStore("links").getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (e) {
        console.error("getAllLinks failed:", e);
        resolve([]);
      }
    });
  },

  /* =====================================================
     UTILITIES
  ===================================================== */
  async clearAll() {
    await this.openDB();
    const stores = ["users", "children", "classes", "sections", "links"];
    for (const s of stores) {
      try {
        const tx = this.db.transaction(s, "readwrite");
        tx.objectStore(s).clear();
      } catch (e) {
        console.error(`clearAll failed for ${s}:`, e);
      }
    }
  },
};
