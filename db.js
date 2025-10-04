// db.js - IndexedDB wrapper
(function () {
  const DB_NAME = 'faceAppDB_v1';
  const DB_VERSION = 1;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        db = e.target.result;
        if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('children')) db.createObjectStore('children', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('relations')) db.createObjectStore('relations', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'id' });
      };

      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };

      req.onerror = (e) => reject(e);
    });
  }

  function put(storeName, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  }

  function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e);
    });
  }

  function del(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  }

  // children constraint
  async function addChild(child) {
    const all = await getAll('children');
    if (all.length >= 1000) throw new Error('Children limit reached');
    return put('children', child);
  }

  window.dbAPI = {
    openDB,
    addUser: (u) => put('users', u),
    getAllUsers: () => getAll('users'),
    deleteUser: (id) => del('users', id),

    addChild,
    getAllChildren: () => getAll('children'),
    deleteChild: (id) => del('children', id),

    addRelation: (r) => put('relations', r),
    getAllRelations: () => getAll('relations'),
    deleteRelation: (id) => del('relations', id),

    addAudit: (a) => put('audit', a),
    getAllAudit: () => getAll('audit'),
    deleteAudit: (id) => del('audit', id),
  };
})();
