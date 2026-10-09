// Background music for playback and videos: short pieces generated in the browser, so they are
// free to use anywhere, or a music file of the user's own, looped and faded to fit.

export const SAMPLE_RATE = 48000;
export const MUSIC_CHOICES = [
  ["none", "None"],
  ["calm", "Calm"],
  ["bright", "Bright"],
  ["file", "Your own"],
];
const FADE_IN = 1;
const FADE_OUT = 2.5;
const MAX_FILE_SECONDS = 600;

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

// A small seeded random generator, so that a piece sounds the same every time.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The pieces. Chords are MIDI notes: pad voicing, bass root and arpeggio notes from low to high.
const PIECES = {
  // D major, slow: Dmaj7, Bm7, Gmaj7, A7, with a soft piano-like arpeggio.
  calm: {
    bpm: 72,
    chords: [
      { pad: [50, 54, 57, 61], bass: 38, arp: [62, 66, 69, 73, 74, 78] },
      { pad: [50, 54, 57, 59], bass: 35, arp: [59, 62, 66, 69, 71, 74] },
      { pad: [50, 54, 55, 59], bass: 31, arp: [59, 62, 66, 67, 71, 74] },
      { pad: [49, 52, 55, 57], bass: 33, arp: [57, 61, 64, 67, 69, 73] },
    ],
    patterns: [
      [0, 2, 4, 3, 5, 4, 2, 3],
      [1, 3, 5, 4, 2, 3, 1, 2],
    ],
    arp: "piano",
    bassHits: [0, 2], // beats
    drums: false,
    reverb: 0.42,
  },
  // G major, lively: G, D, Em, C, with plucked notes, a bass pulse and light drums.
  bright: {
    bpm: 96,
    chords: [
      { pad: [55, 59, 62], bass: 43, arp: [67, 71, 74, 79, 83, 86] },
      { pad: [54, 57, 62], bass: 38, arp: [66, 69, 74, 78, 81, 86] },
      { pad: [55, 59, 64], bass: 40, arp: [67, 71, 76, 79, 83, 88] },
      { pad: [55, 60, 64], bass: 36, arp: [67, 72, 76, 79, 84, 88] },
    ],
    patterns: [
      [0, 2, 1, 3, 2, 4, 3, 5],
      [5, 3, 4, 2, 3, 1, 2, 0],
    ],
    arp: "pluck",
    bassHits: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    drums: true,
    reverb: 0.25,
  },
};

function impulse(ctx, seconds, rand) {
  const len = Math.round(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(0.001, i / len);
  }
  return buf;
}

function noise(ctx, seconds, rand) {
  const buf = ctx.createBuffer(1, Math.round(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return buf;
}

// One note: oscillators with an envelope, into `out`. Plucked notes fade from the start; held
// notes (with `release`) stay at full level, then fade over the release.
function tone(ctx, out, { t, hz, dur, gain, attack = 0.005, release = 0, partials = [[1, 1]], type = "sine", detune = 0 }) {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  if (release) {
    env.gain.setValueAtTime(gain, t + attack + dur - release);
    env.gain.linearRampToValueAtTime(0, t + attack + dur);
  } else env.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  env.connect(out);
  for (const [mult, level] of partials) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz * mult;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(env);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
  }
  return [env, t + attack + dur + 0.05];
}

/**
 * Renders one loop of a piece: every chord with every pattern. The render starts with the loop's
 * last bar, so that the loop begins with that bar's echoes and repeats without a seam.
 */
async function renderLoop(piece, seed) {
  const rand = random(seed);
  const beat = 60 / piece.bpm;
  const bar = beat * 4;
  const loopBars = piece.chords.length * piece.patterns.length;
  const ctx = new OfflineAudioContext(2, Math.ceil((loopBars + 2) * bar * SAMPLE_RATE), SAMPLE_RATE);

  // Mix: dry and reverb into a gentle compressor.
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);
  const dry = ctx.createGain();
  dry.connect(master);
  const send = ctx.createGain();
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3, rand);
  const wet = ctx.createGain();
  wet.gain.value = piece.reverb;
  send.connect(reverb).connect(wet).connect(master);
  const bus = (pan, filterHz) => {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    let head = p;
    if (filterHz) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filterHz;
      f.Q.value = 0.4;
      f.connect(p);
      head = f;
    }
    p.connect(dry);
    p.connect(send);
    return head;
  };
  const padBuses = [bus(-0.35, 2200), bus(0.35, 2200)];
  const bassBus = bus(0, 900);
  const arpBuses = [bus(-0.35, piece.arp === "pluck" ? 5200 : 0), bus(0.35, piece.arp === "pluck" ? 5200 : 0)];
  const drumBus = piece.drums ? bus(0, 0) : null;
  const hiss = piece.drums ? noise(ctx, 0.2, rand) : null;

  // Notes still sounding: [envelope, end time].
  const live = [];
  const keep = (note) => live.push(note);
  // Small variations in timing and loudness, the same each time a bar is played.
  const vary = (b, i) => random(seed * 4099 + b * 64 + i);
  const playBar = (b, t0) => {
    const chord = piece.chords[b % piece.chords.length];
    // Pad: long, soft, slightly detuned pairs.
    for (const m of chord.pad) {
      [-5, 5].forEach((detune, side) => keep(tone(ctx, padBuses[side], { t: t0, hz: midiHz(m), dur: bar + 0.4, gain: 0.02, attack: 0.9, release: 1.3, type: "triangle", detune })));
    }
    // Bass.
    for (const at of piece.bassHits) {
      const octave = piece.drums && at % 1 ? 12 : 0;
      keep(tone(ctx, bassBus, { t: t0 + at * beat, hz: midiHz(chord.bass + octave), dur: piece.drums ? 0.32 : 1.6, gain: piece.drums ? 0.055 : 0.07, attack: 0.02, partials: [[1, 1], [2, 0.5]] }));
    }
    // Arpeggio in eighths; the pattern changes every four bars.
    const pattern = piece.patterns[Math.floor(b / 4) % piece.patterns.length];
    pattern.forEach((idx, i) => {
      const r = vary(b, i);
      const t = Math.max(0, t0 + i * (beat / 2) + (r() - 0.5) * 0.012);
      const accent = i === 0 ? 1 : i % 2 ? 0.62 : 0.78;
      const gain = (piece.arp === "pluck" ? 0.11 : 0.13) * accent * (0.92 + r() * 0.16);
      const hz = midiHz(chord.arp[idx]);
      const out = arpBuses[i % 2];
      if (piece.arp === "piano") keep(tone(ctx, out, { t, hz, dur: 1.9, gain, attack: 0.004, partials: [[1, 1], [2, 0.4], [3, 0.18], [4, 0.08], [5, 0.03]] }));
      else keep(tone(ctx, out, { t, hz, dur: 0.55, gain, attack: 0.003, type: "triangle", partials: [[1, 1], [2, 0.2]] }));
    });
    // Drums: a soft kick on 1 and 3, a shaker on the off-beats.
    if (drumBus) {
      for (const at of [0, 2]) {
        const t = t0 + at * beat;
        const osc = ctx.createOscillator();
        osc.frequency.setValueAtTime(115, t);
        osc.frequency.exponentialRampToValueAtTime(46, t + 0.12);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.13, t + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        osc.connect(env).connect(drumBus);
        osc.start(t);
        osc.stop(t + 0.4);
        keep([env, t + 0.4]);
      }
      for (let i = 0; i < 4; i++) {
        const t = t0 + (i + 0.5) * beat;
        const src = ctx.createBufferSource();
        src.buffer = hiss;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 7000;
        const env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(0.06 * (0.85 + vary(b, 16 + i)() * 0.3), t + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
        src.connect(hp).connect(env).connect(drumBus);
        src.start(t);
        src.stop(t + 0.1);
        keep([env, t + 0.1]);
      }
    }
  };

  // Notes are added a bar at a time and taken out of the graph once they end, which keeps the
  // rendering quick. After the loop, its first bar is played again: the start of the loop is
  // blended with it, so that the end flows into the start.
  playBar(loopBars - 1, 0);
  for (let k = 1; k <= loopBars + 1; k++) {
    const at = k * bar - 0.5;
    ctx.suspend(at).then(() => {
      for (let i = live.length - 1; i >= 0; i--) {
        if (live[i][1] < at) {
          live[i][0].disconnect();
          live.splice(i, 1);
        }
      }
      playBar((k - 1) % loopBars, k * bar);
      ctx.resume();
    });
  }
  const out = await ctx.startRendering();
  const start = Math.round(bar * SAMPLE_RATE);
  const len = Math.round(loopBars * bar * SAMPLE_RATE);
  const blend = Math.round(0.5 * SAMPLE_RATE);
  const loop = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  for (let ch = 0; ch < 2; ch++) {
    const src = out.getChannelData(ch);
    const dst = loop.getChannelData(ch);
    dst.set(src.subarray(start, start + len));
    for (let i = 0; i < blend; i++) dst[i] = (src[start + i] * i + src[start + len + i] * (blend - i)) / blend;
  }
  normalize(loop, 0.8);
  return loop;
}

// The loop repeated to `duration`, faded in and out.
function fitLoop(loop, duration) {
  const len = Math.ceil(duration * SAMPLE_RATE);
  const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  const fadeIn = Math.min(FADE_IN * SAMPLE_RATE, len / 2);
  const fadeOut = Math.min(FADE_OUT * SAMPLE_RATE, len / 2);
  for (let ch = 0; ch < 2; ch++) {
    const src = loop.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < len; i++) dst[i] = src[i % src.length] * Math.min(1, i / fadeIn, (len - i) / fadeOut);
  }
  return out;
}

const loops = new Map(); // piece name -> Promise of its loop

function pieceLoop(name) {
  if (!loops.has(name)) {
    const p = renderLoop(PIECES[name], name === "calm" ? 7 : 11);
    p.catch(() => loops.delete(name));
    loops.set(name, p);
  }
  return loops.get(name);
}

/** Starts making a piece ahead of time, so that playback and export can use it at once. */
export function prepareMusic(choice) {
  if (PIECES[choice] && typeof OfflineAudioContext !== "undefined") pieceLoop(choice).catch(() => {});
}

function playFile(ctx, buffer, duration) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = buffer.duration < duration;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, 0.05);
  env.gain.setValueAtTime(1, Math.max(0.05, duration - FADE_OUT));
  env.gain.linearRampToValueAtTime(0, duration);
  src.connect(env).connect(ctx.destination);
  src.start(0);
}

// Scales the track so that its loudest sample is at `peak`.
function normalize(buffer, peak) {
  let max = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
  }
  if (!max) return;
  const k = peak / max;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

let cached = null; // { key, buffer }

/**
 * The music for a playback or video of `duration` seconds: an AudioBuffer (stereo, 48 kHz),
 * or null for no music. `file` is the user's own music, from readMusicFile.
 */
export async function renderMusic(choice, duration, file = null) {
  if (choice === "none" || (choice === "file" && !file) || !(duration > 0)) return null;
  if (typeof OfflineAudioContext === "undefined") return null;
  const key = `${choice}:${duration.toFixed(3)}:${choice === "file" ? file.id : ""}`;
  if (cached?.key === key) return cached.buffer;
  let buffer;
  if (choice === "file") {
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
    playFile(ctx, file.buffer, duration);
    buffer = await ctx.startRendering();
  } else buffer = fitLoop(await pieceLoop(choice), duration);
  cached = { key, buffer };
  return buffer;
}

let fileIds = 0;

/** Reads a music file of the user's own. Resolves to { id, name, buffer } or throws. */
export async function readMusicFile(file) {
  const bytes = await file.arrayBuffer();
  let buffer;
  try {
    buffer = await new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes);
  } catch {
    throw new Error(`${file.name} could not be read. Try an MP3, M4A, WAV or OGG file.`);
  }
  // Only the first ten minutes are kept: more than any video needs.
  if (buffer.duration > MAX_FILE_SECONDS) {
    const len = MAX_FILE_SECONDS * SAMPLE_RATE;
    const short = new AudioBuffer({ length: len, numberOfChannels: buffer.numberOfChannels, sampleRate: SAMPLE_RATE });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) short.copyToChannel(buffer.getChannelData(ch).subarray(0, len), ch);
    buffer = short;
  }
  return { id: ++fileIds, name: file.name, buffer };
}

/** Plays music alongside the in-page playback, from any point. */
export class MusicPlayer {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.buffer = null;
    this.source = null;
  }
  play(at) {
    this.stop();
    if (!this.ctx || !this.buffer || at >= this.buffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.start(0, at);
    this.source = src;
    this.ctx.resume?.();
  }
  stop() {
    try {
      this.source?.stop();
    } catch {
      // Already stopped.
    }
    this.source = null;
  }
  close() {
    this.stop();
    this.ctx?.close?.();
  }
}
