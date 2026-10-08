/** Standalone owner-started local capture. No cloud job, upload, or auto permission. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_DURATION_MS = 15_000;

/** Also serialized into the local page; dependencies are browser APIs there. */
export function captureController({ getUserMedia, createRecorder, upload, onState = () => {},
  schedule = setTimeout, unschedule = clearTimeout, durationMs = 15_000, maxBytes = 8 * 1024 * 1024 }) {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > 15_000
    || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) throw new Error('invalid_limits');
  let used = false, cancelled = false, stream, recorder, timer, chunks = [], bytes = 0;
  const stopTracks = () => { for (const track of stream?.getTracks() ?? []) track.stop(); };
  const cancel = () => {
    if (cancelled) return;
    cancelled = true; unschedule(timer); stopTracks();
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    chunks = []; onState('cancelled');
  };
  const start = async ({ camera = false, microphone = false } = {}) => {
    if (used || cancelled) throw new Error('session_used');
    if (typeof camera !== 'boolean' || typeof microphone !== 'boolean' || (!camera && !microphone)) throw new Error('select_media');
    used = true; onState('permission');
    try {
      stream = await getUserMedia({ video: camera ? { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 } } : false, audio: microphone });
      if (cancelled) { stopTracks(); return; }
      recorder = createRecorder(stream);
      recorder.ondataavailable = event => {
        if (cancelled || !event.data?.size) return;
        bytes += event.data.size;
        if (bytes > maxBytes) { cancel(); return; }
        chunks.push(event.data);
      };
      recorder.onerror = cancel;
      recorder.onstop = async () => {
        unschedule(timer); stopTracks();
        if (cancelled) return;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType }); chunks = [];
          if (!blob.size || blob.size > maxBytes) throw new Error('invalid_recording');
          onState('saving');
          await upload(blob);
          if (!cancelled) onState('saved');
        } catch { if (!cancelled) { cancelled = true; onState('failed'); } }
      };
      recorder.start(250); onState('recording');
      timer = schedule(() => { if (!cancelled && recorder.state !== 'inactive') recorder.stop(); }, durationMs);
    } catch (error) { unschedule(timer); stopTracks(); if (!cancelled) { cancelled = true; onState('failed'); } throw error; }
  };
  return { start, cancel };
}

function page(token, nonce, durationMs) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>FIRBO local capture</title>
<h1>FIRBO local capture</h1><p>Choose camera and/or microphone, then Start. Your browser and operating system control permission.</p>
<p>At most ${durationMs / 1000} seconds. The recording stays UNENCRYPTED in the private local folder you selected. Nothing is sent to FIRBO or a provider.</p>
<label><input id="camera" type="checkbox">Camera</label> <label><input id="microphone" type="checkbox">Microphone</label>
<p><video id="preview" autoplay muted playsinline width="320" aria-label="Local camera preview"></video></p>
<p><button id="start">Start recording</button> <button id="stop">Stop and discard</button></p><p id="state" role="status">Ready — no capture started.</p>
<script nonce="${nonce}">
const captureController = ${captureController.toString()};
const token = ${JSON.stringify(token)};
const start = document.getElementById('start'), stop = document.getElementById('stop'), status = document.getElementById('state');
const abort = new AbortController();
const controller = captureController({ durationMs: ${durationMs},
 getUserMedia: c => navigator.mediaDevices.getUserMedia(c),
 createRecorder: stream => {
  document.getElementById('preview').srcObject = stream;
  const types = stream.getVideoTracks().length ? ['video/webm;codecs=vp8,opus','video/webm','video/mp4'] : ['audio/webm;codecs=opus','audio/webm','audio/mp4'];
  const mimeType = types.find(t => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('recorder_unsupported');
  return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1000000, audioBitsPerSecond: 96000 });
 },
 upload: async blob => {
  const response = await fetch('/capture', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': blob.type }, body: blob, signal: abort.signal });
  if (!response.ok) throw new Error('capture_rejected');
  const receipt = await response.json();
  status.textContent = 'Saved locally: ' + receipt.bytes + ' bytes; SHA256 ' + receipt.sha256;
 },
 onState: value => { if (value !== 'saved') status.textContent = value; if (['saved','cancelled','failed'].includes(value)) document.getElementById('preview').srcObject = null; }
});
function cancel() { controller.cancel(); abort.abort(); start.disabled = true; void fetch('/cancel', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, keepalive: true }).catch(() => {}); }
start.onclick = () => { start.disabled = true; controller.start({ camera: document.getElementById('camera').checked, microphone: document.getElementById('microphone').checked }).catch(() => {}); };
stop.onclick = cancel;
addEventListener('pagehide', cancel);
document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
const heartbeat = setInterval(async () => { try { const r = await fetch('/alive', { headers: { Authorization: 'Bearer ' + token }, signal: abort.signal }); if (!r.ok) cancel(); } catch { cancel(); clearInterval(heartbeat); } }, 500);
</script></html>`;
}

export async function startLocalCapture({ directory, durationMs = MAX_DURATION_MS, lifetimeMs = 120_000 } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)
    || !Number.isInteger(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS
    || !Number.isInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 120_000) throw new Error('invalid_options');
  const parent = await fs.lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink()
    || (process.platform !== 'win32' && (parent.uid !== process.getuid() || (parent.mode & 0o022)))) throw new Error('unsafe_directory');
  const root = await fs.realpath(directory);
  const privateDirectory = await fs.mkdtemp(path.join(root, 'firbo-media-'));
  await fs.chmod(privateDirectory, 0o700);
  const token = randomBytes(32).toString('hex'), nonce = randomBytes(24).toString('hex');
  let origin, consumed = false, stopped = false, artifact = null;
  const startedAt = Date.now();
  const server = http.createServer(async (req, res) => {
    const respond = (status, body = '') => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); } };
    if (stopped || Date.now() - startedAt >= lifetimeMs) return respond(410);
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)
      || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return respond(403);
    if (req.method === 'GET' && req.url === '/session/' + token) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
        'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=()' });
      return res.end(page(token, nonce, durationMs));
    }
    if (req.headers.authorization !== 'Bearer ' + token) return respond(401);
    if (req.method === 'GET' && req.url === '/alive') return respond(200, '{"ok":true}');
    if (req.method === 'POST' && req.url === '/cancel' && req.headers.origin === origin) {
      stopped = true;
      if (artifact) { await fs.unlink(artifact.path).catch(() => {}); artifact = null; }
      respond(200, '{"cancelled":true}');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/capture') return respond(404);
    if (req.headers.origin !== origin) return respond(403);
    if (consumed) return respond(409);
    consumed = true;
    const mime = req.headers['content-type']?.split(';')[0];
    const declared = req.headers['content-length'];
    if (!['video/webm','audio/webm','video/mp4','audio/mp4'].includes(mime)) return respond(415);
    if (declared && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > MAX_BYTES)) return respond(413);
    const chunks = []; let bytes = 0;
    const watchdog = setTimeout(() => req.destroy(), 5000);
    let handle, file;
    try {
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BYTES) throw new Error('too_large'); chunks.push(chunk); }
      clearTimeout(watchdog);
      if (stopped || Date.now() - startedAt >= lifetimeMs || bytes < 12 || (declared && Number(declared) !== bytes)) throw new Error('invalid_capture');
      const data = Buffer.concat(chunks);
      if (mime.endsWith('webm') ? data.subarray(0,4).toString('hex') !== '1a45dfa3' : data.subarray(4,8).toString() !== 'ftyp') throw new Error('invalid_container');
      file = path.join(privateDirectory, mime.endsWith('webm') ? 'recording.webm' : 'recording.mp4');
      handle = await fs.open(file, 'wx', 0o600);
      await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
      if (stopped) throw new Error('stopped');
      artifact = { path: file, bytes, sha256: createHash('sha256').update(data).digest('hex'), mime };
      respond(200, JSON.stringify(artifact));
    } catch { await handle?.close().catch(() => {}); if (file) await fs.unlink(file).catch(() => {}); respond(400); }
    finally { clearTimeout(watchdog); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + server.address().port;
  const close = async () => { stopped = true; clearTimeout(expiry); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (!artifact) await fs.rm(privateDirectory, { recursive: true, force: true }); };
  const expiry = setTimeout(() => { void close(); }, lifetimeMs);
  return { url: origin + '/session/' + token, origin, close, getArtifact: () => artifact };
}

async function main() {
  const directory = process.argv[2];
  const capture = await startLocalCapture({ directory });
  console.log('Open locally in a supported browser: ' + capture.url);
  console.log('No capture until you click Start and allow permission. Ctrl+C stops the session. Saved media remains locally, unencrypted.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void capture.close(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error('Local capture could not start. Supply an existing absolute local folder path.'); process.exitCode = 1; });
