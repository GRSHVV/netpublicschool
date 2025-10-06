const CACHE_NAME = "pickup-cache-v1";
const urlsToCache = [
  "./",
  "./index.html",
  "./index.js",
  "./style.css",
  "./db.js",
  "./manifest.json",
  "./face-api.min.js",
  "./models/tiny_face_detector_model-weights_manifest.json",
  "./models/face_landmark_68_model-weights_manifest.json",
  "./models/face_recognition_model-weights_manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request))
  );
});
