// sound.js - play beep with cooldown (play once behavior)
let __lastBeep = 0;
function playBeep(isRegistered) {
  const now = Date.now();
  if (now - __lastBeep < 1500) return; // 1.5s cooldown
  __lastBeep = now;

  const actx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  osc.connect(gain); gain.connect(actx.destination);

  if (isRegistered) {
    osc.frequency.setValueAtTime(1000, actx.currentTime);
    gain.gain.setValueAtTime(0.18, actx.currentTime);
    osc.start(); osc.stop(actx.currentTime + 0.18);
  } else {
    osc.frequency.setValueAtTime(500, actx.currentTime);
    gain.gain.setValueAtTime(0.35, actx.currentTime);
    osc.start(); osc.stop(actx.currentTime + 1.0);
  }
}
