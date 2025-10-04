window.dbAPI = {
  db: null,
  async openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("faceDB", 1);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => reject(e);
    });
  },

  async addUser(user) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("users", "readwrite");
      tx.objectStore("users").put(user);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  },

  async getAllUsers() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("users", "readonly");
      const store = tx.objectStore("users");
      const request = store.getAll();
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e);
    });
  },

  async deleteUser(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("users", "readwrite");
      tx.objectStore("users").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  }
};
