// db.js — Full IndexedDB implementation for Smart Pickup System
// Supports multiple modules: users, children, classes, sections, and parent-child linking

window.dbAPI = {
  db: null,

  async openDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("FacePickupDB", 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("children")) {
          db.createObjectStore("children", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("classes")) {
          db.createObjectStore("classes", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("sections")) {
          db.createObjectStore("sections", { keyPath: "id", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains("links")) {
          db.createObjectStore("links", { keyPath: "parentId" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };
      request.onerror = (event) => reject(event.target.error);
    });
  },

  /* ---------------- USERS (PARENTS) ---------------- */
  async addUser(user) {
    const tx = this.db.transaction("users", "readwrite");
    const store = tx.objectStore("users");
    await store.put(user);
    return tx.done;
  },

  async getAllUsers() {
    const tx = this.db.transaction("users", "readonly");
    const store = tx.objectStore("users");
    return await store.getAll();
  },

  /* ---------------- CHILDREN ---------------- */
  async addChild(child) {
    const tx = this.db.transaction("children", "readwrite");
    const store = tx.objectStore("children");
    await store.put(child);
    return tx.done;
  },

  async getAllChildren() {
    const tx = this.db.transaction("children", "readonly");
    const store = tx.objectStore("children");
    return await store.getAll();
  },

  /* ---------------- CLASSES ---------------- */
  async addClass(name) {
    const tx = this.db.transaction("classes", "readwrite");
    const store = tx.objectStore("classes");
    await store.put({ id: Date.now().toString(), name });
    return tx.done;
  },

  async deleteClass(id) {
    const tx = this.db.transaction("classes", "readwrite");
    await tx.objectStore("classes").delete(id);
    return tx.done;
  },

  async getAllClasses() {
    const tx = this.db.transaction("classes", "readonly");
    const store = tx.objectStore("classes");
    return await store.getAll();
  },

  /* ---------------- SECTIONS ---------------- */
  async addSection(name) {
    const tx = this.db.transaction("sections", "readwrite");
    const store = tx.objectStore("sections");
    await store.put({ id: Date.now().toString(), name });
    return tx.done;
  },

  async deleteSection(id) {
    const tx = this.db.transaction("sections", "readwrite");
    await tx.objectStore("sections").delete(id);
    return tx.done;
  },

  async getAllSections() {
    const tx = this.db.transaction("sections", "readonly");
    const store = tx.objectStore("sections");
    return await store.getAll();
  },

  /* ---------------- PARENT–CHILD LINKS ---------------- */
  async linkParentChildren(parentId, childIds) {
    const tx = this.db.transaction("links", "readwrite");
    const store = tx.objectStore("links");
    const existing = await store.get(parentId);

    if (existing) {
      // Merge with existing linked children
      const merged = [...new Set([...existing.childrenIds, ...childIds])];
      existing.childrenIds = merged;
      await store.put(existing);
    } else {
      await store.put({ parentId, childrenIds: childIds });
    }
    await tx.done;
  },

  async unlinkChild(parentId, childId) {
    const tx = this.db.transaction("links", "readwrite");
    const store = tx.objectStore("links");
    const link = await store.get(parentId);
    if (link) {
      link.childrenIds = link.childrenIds.filter((id) => id !== childId);
      await store.put(link);
    }
    await tx.done;
  },

  async getAllLinks() {
    const tx = this.db.transaction("links", "readonly");
    const store = tx.objectStore("links");
    return await store.getAll();
  },
};
