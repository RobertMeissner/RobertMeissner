let ctx: AudioContext | null = null;

export function ensureAudio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) throw new Error("WebAudio not supported");
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export function beep(freq = 440, dur = 0.08, type: OscillatorType = "square", vol = 0.05, slide = 0): void {
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

export function chord(freqs: number[], dur = 0.25, type: OscillatorType = "triangle", vol = 0.06): void {
  freqs.forEach((f, i) => setTimeout(() => beep(f, dur, type, vol), i * 45));
}
