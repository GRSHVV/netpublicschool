// db.js — IndexedDB for Parents, Children, Links
window.dbAPI = {
  db: null,
  async openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("FacePickupDB", 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("users"))
          db.createObjectStore("users", { keyPath: "id" });
        if (!db.objectStoreNames.contains("children"))
          db.createObjectStore("children", { keyPath: "id" });
        if (!db.objectStoreNames.contains("links"))
          db.createObjectStore("links", { keyPath: "parentId" });
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = (e) => reject(e);
    });
  },
  async addUser(u) {
    const tx = this.db.transaction("users", "readwrite");
    tx.objectStore("users").put(u);
  },
  async getAllUsers() {
    return new Promise((res) => {
      const tx = this.db.transaction("users", "readonly");
      const req = tx.objectStore("users").getAll();
      req.onsuccess = () => res(req.result);
    });
  },
  async addChild(c) {
    const tx = this.db.transaction("children", "readwrite");
    tx.objectStore("children").put(c);
  },
  async getAllChildren() {
    return new Promise((res) => {
      const tx = this.db.transaction("children", "readonly");
      const req = tx.objectStore("children").getAll();
      req.onsuccess = () => res(req.result);
    });
  },
  async linkParentChildren(parentId, childrenIds) {
    const tx = this.db.transaction("links", "readwrite");
    tx.objectStore("links").put({ parentId, childrenIds });
  },
  async getAllLinks() {
    return new Promise((res) => {
      const tx = this.db.transaction("links", "readonly");
      const req = tx.objectStore("links").getAll();
      req.onsuccess = () => res(req.result);
    });
  },
};
