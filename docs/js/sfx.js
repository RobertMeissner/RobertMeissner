let ctx = null;

export function ensureAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function beep(freq = 440, dur = 0.08, type = "square", vol = 0.05, slide = 0) {
  try {
    const a = ensureAudio();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  } catch (e) {}
}

export function chord(freqs, dur = 0.25, type = "triangle", vol = 0.06) {
  freqs.forEach((f, i) => setTimeout(() => beep(f, dur, type, vol), i * 45));
}
