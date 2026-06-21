const DB_NAME = "varden-db";
const DB_VERSION = 1;
const STORE_NAME = "characters";
const IMG_STORE = "images";

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) { resolve(db); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!d.objectStoreNames.contains(IMG_STORE)) {
        d.createObjectStore(IMG_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

export async function getCharacters() {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCharacter(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCharacter(character) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(character);
    tx.oncomplete = () => resolve(character);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteCharacter(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveImage(id, dataUrl) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readwrite");
    tx.objectStore(IMG_STORE).put({ id, data: dataUrl });
    tx.oncomplete = () => resolve({ id, dataUrl });
    tx.onerror = () => reject(tx.error);
  });
}

export async function getImage(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readonly");
    const req = tx.objectStore(IMG_STORE).get(id);
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteImage(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readwrite");
    tx.objectStore(IMG_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
