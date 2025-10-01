const CACHE_NAME = "face-kiosk-v1";
const toCache = [
  "/", "/index.html", "/admin.html", "/children.html", "/relations.html", "/recognize.html",
  "/style.css", "/db.js", "/admin.js", "/children.js", "/relations.js", "/recognize.js",
  "/sound.js", "/face-api.min.js", "/manifest.json"
  // models should be added too, see examples below
];

// add models explicitly if present
const modelFiles = [
  "/models/tiny_face_detector_model-weights_manifest.json",
  "/models/tiny_face_detector_model-shard1",
  "/models/face_landmark_68_model-weights_manifest.json",
  "/models/face_landmark_68_model-shard1",
  "/models/face_recognition_model-weights_manifest.json",
  "/models/face_recognition_model-shard1"
];
toCache.push(...modelFiles);

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(toCache)).catch(err => console.warn("SW cache error", err))
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
