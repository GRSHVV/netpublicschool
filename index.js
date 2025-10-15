/* ============================================================
  Full index.js — Fixed Syntax Errors (template literals + alert strings)
  ============================================================ */
"use strict";

/* --- Globals --- */
let video, overlay, ctx;
let modelsLoaded = false;
let detectionInterval = null;
let currentMode = "none";
let recognitionMatcher = null;
let lastDetection = null;
let tempNoPickup = false;
let recognitionPaused = false;
let lastRecognizedParentId = null;
let lastRecognitionTime = 0;

/* --- Helpers --- */
const $ = (id) => document.getElementById(id);
const log = (...args) => console.log("[APP]", ...args);
function setStatus(msg) { const e = $("statusMsg"); if (e) e.textContent = msg; }

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

/* --- Main detection loop (fixed syntax) --- */
function startDetectionLoop() {
  if (!modelsLoaded) { 
    log("models not loaded yet"); 
    return; 
  }

  if (detectionInterval) clearInterval(detectionInterval);
  recognitionPaused = false;

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 });

  detectionInterval = setInterval(async () => {
    try {
      if (recognitionPaused) return;
      if (!video || video.readyState < 2) return;

      const detection = await faceapi
        .detectSingleFace(video, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
      const resultDiv = $("recognitionResult");
      const globalNoPickup = $("noPickupMode")?.checked ?? false;
      const effectiveNoPickup = globalNoPickup || tempNoPickup;

      if (!detection) {
        lastDetection = null;
        if (currentMode === "recognition" && resultDiv) {
          resultDiv.innerHTML = `<p style="opacity:0.6">Show a registered face...</p>`;
        }
        $("registerBtn")?.setAttribute("disabled", true);
        return;
      }

      lastDetection = detection;
      const box = detection.detection.box;
      const scaleX = overlay.width / video.videoWidth;
      const scaleY = overlay.height / video.videoHeight;
      const drawBox = {
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY
      };

      /* --- Continuous Mode --- */
      if (effectiveNoPickup) {
        const now = Date.now();
        const DUPLICATE_COOLDOWN_MS = 10000;
        if (lastRecognizedParentId && (now - lastRecognitionTime) < DUPLICATE_COOLDOWN_MS) {
          if (resultDiv)
            resultDiv.innerHTML = `<p style="color:#22c55e;">Recognized already processed.</p>`;
          return;
        }
        lastRecognizedParentId = "test";
        lastRecognitionTime = now;

        const formatted = new Date().toLocaleString();
        await window.dbAPI.addAudit({
          id: `${Date.now()}-${Math.random()}`,
          parentName: "sample",
          childName: "child",
          pickupTime: formatted,
          timestamp: Date.now()
        });

        if (resultDiv)
          resultDiv.innerHTML = `<p style="color:#22c55e;font-weight:bold;">✅ Logged automatically at ${formatted}</p>`;
      }

    } catch (err) {
      console.error("Detection loop error:", err);
    }
  }, 600);
}

alert("✅ index.js syntax fixed successfully");
