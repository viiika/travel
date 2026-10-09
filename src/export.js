import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";

const H264_CODECS = ["avc1.640033", "avc1.640028", "avc1.4d0033", "avc1.42003e"];
const VP9_CODECS = ["vp09.00.40.08", "vp09.00.10.08"];

async function pickCodec(list, width, height, fps, bitrate) {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of list) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
      if (supported) return codec;
    } catch {
      // Try the next profile.
    }
  }
  return null;
}

async function pickAudioCodec(list, audio) {
  if (typeof AudioEncoder === "undefined") return null;
  for (const [codec, muxCodec] of list) {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({ codec, sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels, bitrate: 192000 });
      if (supported) return { codec, muxCodec };
    } catch {
      // Try the next codec.
    }
  }
  return null;
}

// AAC is what MP4 players expect; Opus in MP4 plays in browsers and most players too.
const MP4_AUDIO = [
  ["mp4a.40.2", "aac"],
  ["opus", "opus"],
];
const WEBM_AUDIO = [["opus", "A_OPUS"]];

/**
 * Renders frames deterministically and encodes a video.
 * draw(ctx, t) must paint the frame for time t (seconds) at width x height.
 * audio is an optional AudioBuffer for the soundtrack.
 * Returns { blob, ext, audio } where audio tells whether the soundtrack is in the video.
 */
export async function exportVideo({ width, height, fps = 30, duration, draw, audio = null, onProgress, signal }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  const bitrate = Math.round(width * height * fps * 0.18);
  const total = Math.ceil(duration * fps);
  const opts = { canvas, ctx, width, height, fps, total, draw, bitrate, onProgress, signal };
  // MP4 / H.264 plays everywhere; VP9 WebM is the fallback where H.264 encoding is unavailable.
  const h264 = await pickCodec(H264_CODECS, width, height, fps, bitrate);
  if (h264) return encode({ ...opts, codec: h264, container: "mp4", audio, audioCodec: audio && (await pickAudioCodec(MP4_AUDIO, audio)) });
  const vp9 = await pickCodec(VP9_CODECS, width, height, fps, bitrate);
  if (vp9) return encode({ ...opts, codec: vp9, container: "webm", audio, audioCodec: audio && (await pickAudioCodec(WEBM_AUDIO, audio)) });
  return recordWebm({ ...opts, audio });
}

export async function supportedFormat() {
  if (await pickCodec(H264_CODECS, 1920, 1080, 30, 8e6)) return "MP4 (H.264)";
  if (await pickCodec(VP9_CODECS, 1920, 1080, 30, 8e6)) return "WebM (VP9)";
  return "WebM";
}

async function encode({ canvas, ctx, width, height, fps, total, draw, codec, container, bitrate, audio, audioCodec, onProgress, signal }) {
  const sound = audio && audioCodec ? { codec: audioCodec.muxCodec, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } : undefined;
  const muxer =
    container === "mp4"
      ? new Mp4Muxer({ target: new Mp4Target(), video: { codec: "avc", width, height, frameRate: fps }, audio: sound, fastStart: "in-memory", firstTimestampBehavior: "offset" })
      : new WebmMuxer({ target: new WebmTarget(), video: { codec: "V_VP9", width, height, frameRate: fps }, audio: sound, firstTimestampBehavior: "offset" });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: "quality" });
  const soundtrack = sound ? audioWriter(audio, audioCodec.codec, muxer, (e) => (failure = e)) : null;
  const frameUs = 1e6 / fps;
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      encoder.close();
      soundtrack?.close();
      throw new DOMException("Export cancelled", "AbortError");
    }
    if (failure) throw failure;
    // The soundtrack is encoded a little ahead of the pictures, so that the two interleave.
    soundtrack?.writeUntil((i + fps) / fps);
    draw(ctx, i / fps);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 5 === 0) {
      onProgress?.(i / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  if (soundtrack) {
    soundtrack.writeUntil(total / fps);
    await soundtrack.finish();
  }
  if (failure) throw failure;
  muxer.finalize();
  onProgress?.(1);
  return { blob: new Blob([muxer.target.buffer], { type: `video/${container}` }), ext: container, audio: !!soundtrack };
}

// Feeds an AudioBuffer to an AudioEncoder in blocks, up to a given time.
function audioWriter(buffer, codec, muxer, onError) {
  const rate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const data = Array.from({ length: channels }, (_, ch) => buffer.getChannelData(ch));
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: onError,
  });
  encoder.configure({ codec, sampleRate: rate, numberOfChannels: channels, bitrate: 192000 });
  const BLOCK = 4800; // 0.1 s
  let pos = 0;
  return {
    writeUntil(seconds) {
      const end = Math.min(buffer.length, Math.round(seconds * rate));
      while (pos < end) {
        const n = Math.min(BLOCK, end - pos);
        const planar = new Float32Array(n * channels);
        for (let ch = 0; ch < channels; ch++) planar.set(data[ch].subarray(pos, pos + n), ch * n);
        const chunk = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((pos / rate) * 1e6), data: planar });
        encoder.encode(chunk);
        chunk.close();
        pos += n;
      }
    },
    async finish() {
      await encoder.flush();
      encoder.close();
    },
    close() {
      if (encoder.state !== "closed") encoder.close();
    },
  };
}

// Fallback for browsers without WebCodecs: records in real time.
async function recordWebm({ canvas, ctx, fps, total, draw, audio, onProgress, signal }) {
  const stream = canvas.captureStream(fps);
  // The soundtrack plays into the recording in real time, as the pictures do.
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = audio && AC ? new AC() : null;
  let music = null;
  if (actx) {
    const dest = actx.createMediaStreamDestination();
    music = actx.createBufferSource();
    music.buffer = audio;
    music.connect(dest);
    for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  }
  const types = actx ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"] : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (recorder.onstop = r));
  draw(ctx, 0);
  recorder.start();
  if (music) {
    await actx.resume();
    music.start();
  }
  const start = performance.now();
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (signal?.aborted) return reject(new DOMException("Export cancelled", "AbortError"));
      const i = Math.min(total, Math.floor(((performance.now() - start) / 1000) * fps));
      draw(ctx, i / fps);
      onProgress?.(i / total);
      if (i >= total) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }).finally(() => {
    if (recorder.state !== "inactive") recorder.stop();
    actx?.close();
  });
  await done;
  return { blob: new Blob(chunks, { type: "video/webm" }), ext: "webm", audio: !!actx };
}

// Saves a file. Inside a claude.ai Artifact, downloads go through the viewer's
// "downloads" capability; in a plain browser, through a temporary link.
// Resolves true when the file was handed over, false when the viewer declined.
export async function download(blob, filename) {
  const downloads = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return true;
    } catch (e) {
      if (e?.code === "declined") return false;
      throw new Error(e?.message || "Saving is not available here");
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
