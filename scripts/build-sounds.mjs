// Rebuild procedural cues; keep the imported Harrow recordings in assets/sounds intact.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');

let seed = 0x5eed;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 31 - 1; };
const envelope = (t, length, attack = 0.005) => Math.min(1, t / attack) * Math.max(0, 1 - t / length) ** 2;

function render(seconds, sample) {
  const data = new Float32Array(Math.ceil(seconds * RATE));
  for (let i = 0; i < data.length; i++) data[i] = sample(i / RATE);
  return data;
}
function tone(frequency, start, length, { gain = 0.5, harmonic = 0.25, glide = 0 } = {}) {
  return t => {
    const local = t - start;
    if (local < 0 || local > length) return 0;
    const phase = 2 * Math.PI * (frequency * local + glide * local * local / (2 * length));
    return gain * envelope(local, length) * (Math.sin(phase) + harmonic * Math.sin(2 * phase));
  };
}
function burst(start, length, gain, smoothing) {
  let last = 0;
  return t => {
    const local = t - start;
    if (local < 0 || local > length) return 0;
    last += (noise() - last) * smoothing;
    return gain * envelope(local, length, 0.002) * last;
  };
}
const mix = (...voices) => t => voices.reduce((sum, voice) => sum + voice(t), 0);

const sounds = {
  tap: render(0.05, mix(tone(1760, 0, 0.035, { gain: 0.18, harmonic: 0 }), burst(0, 0.02, 0.12, 0.6))),
  schedule: render(0.3, mix(tone(660, 0, 0.1, { gain: 0.3 }), tone(990, 0.12, 0.14, { gain: 0.3 }))),
  alarm: render(1.0, mix(...[0, 0.25, 0.5, 0.75].map((start, i) => tone(i % 2 ? 330 : 440, start, 0.22, { gain: 0.3, harmonic: 0.5 })))),
  victory: render(1.6, mix(tone(392, 0, 1.5, { gain: 0.2 }), tone(494, 0.15, 1.35, { gain: 0.2 }), tone(587, 0.3, 1.2, { gain: 0.2 }), tone(784, 0.45, 1.1, { gain: 0.16 }))),
  defeat: render(1.8, mix(tone(147, 0, 1.7, { gain: 0.3, glide: -30 }), tone(175, 0.1, 1.6, { gain: 0.22, glide: -30 }), burst(0, 1.2, 0.15, 0.03))),
  error: render(0.22, mix(tone(150, 0, 0.09, { gain: 0.35, harmonic: 0.8 }), tone(150, 0.11, 0.09, { gain: 0.35, harmonic: 0.8 }))),
  // Controls: short, quiet, and distinguishable by contour rather than volume.
  select: render(0.06, mix(tone(2350, 0, 0.045, { gain: 0.2, harmonic: 0 }), burst(0, 0.012, 0.08, 0.7))),
  back: render(0.12, mix(tone(1320, 0, 0.05, { gain: 0.2, harmonic: 0.1 }), tone(880, 0.055, 0.06, { gain: 0.2, harmonic: 0.1 }))),
  confirm: render(0.15, mix(tone(990, 0, 0.055, { gain: 0.2, harmonic: 0.15 }), tone(1480, 0.06, 0.08, { gain: 0.22, harmonic: 0.15 }))),
  time: render(0.12, mix(burst(0, 0.015, 0.2, 0.9), tone(3100, 0, 0.02, { gain: 0.1, harmonic: 0 }), burst(0.07, 0.015, 0.16, 0.9), tone(2600, 0.07, 0.02, { gain: 0.08, harmonic: 0 }))),
  // Outcomes: each names what happened in the belt.
  cancel: render(0.32, mix(tone(660, 0, 0.13, { gain: 0.28, harmonic: 0.3 }), tone(440, 0.14, 0.16, { gain: 0.28, harmonic: 0.3 }))),
  build: render(0.55, mix(burst(0, 0.08, 0.4, 0.25), tone(196, 0, 0.18, { gain: 0.35, harmonic: 0.6 }), burst(0.2, 0.08, 0.35, 0.25), tone(294, 0.2, 0.3, { gain: 0.3, harmonic: 0.6 }))),
  recruit: render(0.55, mix(tone(523, 0, 0.16, { gain: 0.25 }), tone(659, 0.12, 0.16, { gain: 0.25 }), tone(784, 0.24, 0.3, { gain: 0.25 }))),
  shield: render(0.65, mix(tone(320, 0, 0.6, { gain: 0.25, harmonic: 0.4, glide: 520 }), tone(640, 0.05, 0.55, { gain: 0.08, harmonic: 0, glide: 900 }))),
  pulse: render(0.9, mix(tone(880, 0, 0.85, { gain: 0.3, harmonic: 0.5, glide: -720 }), burst(0, 0.6, 0.18, 0.05))),
  council: render(1.1, mix(tone(523, 0, 1.0, { gain: 0.2, harmonic: 0.35 }), tone(784, 0.02, 0.95, { gain: 0.16, harmonic: 0.35 }), tone(1046, 0.04, 0.6, { gain: 0.08, harmonic: 0 }))),
  intel: render(0.36, mix(tone(1500, 0, 0.06, { gain: 0.22, harmonic: 0 }), tone(1800, 0.1, 0.06, { gain: 0.22, harmonic: 0 }), tone(1500, 0.2, 0.12, { gain: 0.22, harmonic: 0 }))),
  gift: render(0.5, mix(tone(784, 0, 0.2, { gain: 0.22, harmonic: 0.2 }), tone(1046, 0.1, 0.25, { gain: 0.22, harmonic: 0.2 }), tone(1568, 0.2, 0.28, { gain: 0.1, harmonic: 0 }))),
  message: render(0.32, mix(tone(988, 0, 0.1, { gain: 0.25, harmonic: 0.1 }), tone(1319, 0.12, 0.18, { gain: 0.25, harmonic: 0.1 }))),
};

// Peak level per sound, so quiet UI ticks stay quieter than outcomes.
const levels = { tap: 0.3, select: 0.28, back: 0.3, confirm: 0.35, time: 0.3, schedule: 0.55, cancel: 0.5, error: 0.55, intel: 0.5, message: 0.6, gift: 0.6, recruit: 0.65 };

function wav(samples, level) {
  const peak = samples.reduce((max, s) => Math.max(max, Math.abs(s)), 1e-9);
  const scale = level / peak;
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples.length * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24); buffer.writeUInt32LE(RATE * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * scale)) * 32767), 44 + i * 2));
  return buffer;
}

mkdirSync(out, { recursive: true });
for (const [name, samples] of Object.entries(sounds)) writeFileSync(join(out, `${name}.wav`), wav(samples, levels[name] ?? 0.85));
console.log(`Wrote ${Object.keys(sounds).length} sounds to ${out}`);
