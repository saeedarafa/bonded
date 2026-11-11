#!/usr/bin/env node
/**
 * Renders the five little-things gesture sounds (D48, MOB-65) to WAV files.
 *
 *   node design-handoff/assets/sounds/render-sounds.mjs
 *
 * Writes `little_thing_<kind>.wav` for hug, kiss, miss_you, good_morning and goodnight into this
 * folder (for the PO to listen to) and the identical bundled copies into `assets/sounds/` (the app
 * plays them in-app and uses them as the iOS notification sound and the Android channel sound,
 * CONTRACTS §5). No dependencies: plain Node, byte-for-byte reproducible (seeded noise and dither).
 *
 * The sounds are the original WebAudio synth of `design-handoff/prototypes/little-things.html`
 * (`tone()` and `SOUNDS`), re-implemented sample by sample: sine and band-limited triangle
 * oscillators with exponential pitch glides, linear attack + exponential decay envelopes, and the
 * WebAudio biquad lowpass / bandpass filters. Changes from the prototype, so each file stands alone:
 * - the lead-in silence the prototype uses to sync with the animation is removed;
 * - hug renders a 1 s hug (prototype default 1.4 s) and goodnight's three notes are a little
 *   closer and shorter, so both stay under 1.5 s;
 * - miss you adds a soft harmonic layer (4x the heartbeat pitch) so the 42-90 Hz heartbeat can be
 *   heard on a phone speaker, which plays almost nothing below ~200 Hz.
 *
 * Format: WAV, 16-bit linear PCM, mono, 11 025 Hz (rendered at 44.1 kHz, then low-passed and
 * decimated). Linear PCM WAV is the one format that both iOS notification sounds and Android
 * notification channels (res/raw) accept, under the same file name on both platforms. Each file is
 * peak-normalised to -3 dBFS, at most 1.45 s, and 9-32 KB.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const OUT_DIRS = [HERE, join(ROOT, 'assets/sounds')];

const SR = 44100; // render rate
const DECIMATE = 4; // 44100 / 4 = 11025 Hz output
const OUT_SR = SR / DECIMATE;
const MAX_SECONDS = 1.45;
const PEAK = 10 ** (-3 / 20); // -3 dBFS

/** Small seeded PRNG (mulberry32), so noise and dither are the same on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A biquad as in the WebAudio spec; coefficients may change per sample. */
function biquad() {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x, [b0, b1, b2, a1, a2]) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

/** WebAudio `lowpass` (Q in dB, default 1). */
function lowpassCoefs(freq, qDb = 1) {
  const w0 = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w0) / (2 * 10 ** (qDb / 20));
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** WebAudio `bandpass` (constant 0 dB peak, linear Q). */
function bandpassCoefs(freq, q) {
  const w0 = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return [alpha / a0, 0, -alpha / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** Band-limited waveforms (WebAudio oscillators are band-limited too). */
function wave(type, phase, freq) {
  if (type === 'sine') return Math.sin(phase);
  // triangle: odd harmonics, 1/n^2, alternating sign; stop below 10 kHz.
  let sum = 0;
  for (let n = 1, k = 0; n * freq < 10000; n += 2, k++) {
    sum += ((k % 2 ? -1 : 1) * Math.sin(n * phase)) / (n * n);
  }
  return (8 / (Math.PI * Math.PI)) * sum;
}

/** The prototype's `tone()`: a glide, a linear attack and an exponential decay to 0.0008. */
function tone(buf, t0, f, dur, { type = 'sine', vol = 0.18, attack = 0.01, f2 = null, lp = null } = {}) {
  const start = Math.round(t0 * SR);
  const end = Math.min(buf.length, Math.round((t0 + dur + 0.05) * SR));
  const filter = lp ? biquad() : null;
  const lpc = lp ? lowpassCoefs(lp) : null;
  const glide = dur * 0.8;
  let phase = 0;
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    const freq = f2 && t < glide ? f * (f2 / f) ** (t / glide) : f2 ?? f;
    phase += (2 * Math.PI * freq) / SR;
    let gain;
    if (t < attack) gain = (vol * t) / attack;
    else if (t < dur) gain = vol * (0.0008 / vol) ** ((t - attack) / (dur - attack));
    else gain = 0.0008;
    let s = wave(type, phase, freq);
    if (filter) s = filter(s, lpc);
    buf[i] += s * gain;
  }
}

/** Hug's "soft squeeze": noise through a gliding band-pass that swells and settles. */
function squeeze(buf, t0) {
  const noise = rng(0x6875_67);
  const filter = biquad();
  const start = Math.round(t0 * SR);
  const end = Math.min(buf.length, start + Math.round(0.7 * SR));
  for (let i = start; i < end; i++) {
    const t = (i - start) / SR;
    const freq = t < 0.5 ? 380 * (180 / 380) ** (t / 0.5) : 180;
    let gain;
    if (t < 0.12) gain = (0.16 * t) / 0.12;
    else if (t < 0.6) gain = 0.16 * (0.001 / 0.16) ** ((t - 0.12) / 0.48);
    else gain = 0.001;
    buf[i] += filter(noise() * 2 - 1, bandpassCoefs(freq, 1.2)) * gain;
  }
}

const SOUNDS = {
  hug(buf) {
    const len = 1;
    squeeze(buf, 0);
    tone(buf, 0.18, 329.6, len * 0.5 + 0.4, { vol: 0.12, attack: 0.12, f2: 392, lp: 1400 });
    tone(buf, 0.18, 261.6, len * 0.5 + 0.4, { vol: 0.08, attack: 0.12, f2: 329.6, lp: 1100 });
    tone(buf, 0.25 + len * 0.5, 1568, 0.6, { vol: 0.05 });
    tone(buf, 0.33 + len * 0.5, 2093, 0.5, { vol: 0.035 });
  },
  kiss(buf) {
    tone(buf, 0.01, 880, 0.14, { type: 'triangle', vol: 0.16, f2: 520 });
    tone(buf, 0.14, 1180, 0.12, { type: 'sine', vol: 0.12, f2: 900 });
  },
  goodnight(buf) {
    [
      [1318.5, 0],
      [1046.5, 0.3],
      [880, 0.6],
    ].forEach(([f, d]) => {
      tone(buf, d + 0.01, f, 0.8, { vol: 0.11 });
      tone(buf, d + 0.01, f * 2, 0.4, { vol: 0.025 });
    });
  },
  good_morning(buf) {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) =>
      tone(buf, 0.01 + i * 0.11, f, 0.45, { type: 'triangle', vol: 0.12 }),
    );
  },
  miss_you(buf) {
    [0, 0.24, 0.9, 1.14].forEach((d, i) => {
      const f = i % 2 ? 70 : 90;
      tone(buf, d + 0.01, f, 0.28, { vol: 0.5, f2: 42, attack: 0.005, lp: 300 });
      // Speaker layer: the same beat two octaves up, quiet and dark.
      tone(buf, d + 0.01, f * 4, 0.22, { vol: 0.14, f2: 42 * 4, attack: 0.005, lp: 700 });
    });
  },
};

/** Blackman-windowed sinc low-pass at 0.45 x the output rate, then keep every 4th sample. */
function decimate(input) {
  const taps = 255;
  const half = (taps - 1) / 2;
  const fc = (0.45 * OUT_SR) / SR;
  const h = new Float64Array(taps);
  let norm = 0;
  for (let n = 0; n < taps; n++) {
    const m = n - half;
    const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const w =
      0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1));
    h[n] = sinc * w;
    norm += h[n];
  }
  const out = new Float64Array(Math.ceil(input.length / DECIMATE));
  for (let o = 0; o < out.length; o++) {
    const c = o * DECIMATE;
    let acc = 0;
    for (let n = 0; n < taps; n++) {
      const i = c + n - half;
      if (i >= 0 && i < input.length) acc += input[i] * h[n];
    }
    out[o] = acc / norm;
  }
  return out;
}

/** Normalise, trim the silent tail, fade the last 20 ms, dither to 16 bit. */
function finish(samples, seed) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const scaled = samples.map((s) => (s / peak) * PEAK);
  const floor = 10 ** (-60 / 20);
  let last = scaled.length - 1;
  while (last > 0 && Math.abs(scaled[last]) < floor) last--;
  const length = Math.min(last + 1, Math.floor(MAX_SECONDS * OUT_SR));
  const fade = Math.round(0.02 * OUT_SR);
  const dither = rng(seed);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const tail = length - i;
    const g = tail < fade ? tail / fade : 1;
    const tpdf = (dither() - dither()) / 32768;
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round((scaled[i] * g + tpdf) * 32767)));
  }
  return pcm;
}

function wav(pcm) {
  const data = pcm.length * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // linear PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(OUT_SR, 24);
  b.writeUInt32LE(OUT_SR * 2, 28); // byte rate
  b.writeUInt16LE(2, 32); // block align
  b.writeUInt16LE(16, 34); // bits per sample
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}

for (const dir of OUT_DIRS) mkdirSync(dir, { recursive: true });
Object.entries(SOUNDS).forEach(([kind, render], index) => {
  const buf = new Float64Array(Math.round(1.6 * SR));
  render(buf);
  const file = wav(finish(decimate(buf), 0xb0d + index));
  const name = `little_thing_${kind}.wav`;
  for (const dir of OUT_DIRS) writeFileSync(join(dir, name), file);
  const seconds = (file.length - 44) / 2 / OUT_SR;
  console.log(`${name}  ${seconds.toFixed(2)} s  ${(file.length / 1024).toFixed(1)} KB`);
});
