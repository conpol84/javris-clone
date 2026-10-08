# FIRBO local camera/microphone preparation — 2026-10-08

## Changed

Standalone local capture module for a supported browser on Windows, macOS or
Linux. Nothing starts until the owner opens the local session page, chooses the
inputs, clicks Start and grants browser/OS permission. The server binds only to
127.0.0.1 with a random session URL/token, exact Host/Origin checks and no CORS.
The page has a nonce CSP and refuses framing.

The interactive browser limits capture to 15 seconds; the server bounds the
upload to 8 MiB and its one-use session to 120 seconds. The server checks a
container signature, not decoded media duration or media validity. Stop discards the local
recording, including a late permission result. Hidden/page-exit behavior stops
tracks; a local-server heartbeat failure also cancels. A successful finite capture
saves a local file and returns its SHA256; it does not send media to any cloud.
Browser timer suspension/OS sleep can delay timers: this is not a hard real-time
hardware cutoff. Closing the browser or using the OS permission controls remains
an independent local stop.

Manual local use after reviewed delivery:

```sh
node firbo-media.mjs /absolute/path/to/an/existing/private/folder
```

The program prints a one-use local URL; it never launches a browser itself.
POSIX session directories/files use 0700/0600. Windows uses inherited folder ACLs;
the owner must select a private folder and verify ACLs during real-device acceptance.
The file is unencrypted. Stop and discard deletes it; normal successful recording
remains until the owner deletes it. This is an original FIRBO module, not a full
remote desktop or continuous camera feed.
If the browser cannot reach the local server or the filesystem refuses deletion,
the recording may remain in that folder; successful deletion is not claimed on
a failed request. Check the local folder before considering cleanup complete.

## Tested / passed

Node executable tests exercise actual loopback HTTP and local filesystem bytes,
hashes, repeat/foreign-origin/auth/container rejection and deletion. Browser
capture lifecycle tests use explicit synthetic streams/recorders: start, expiry,
Stop, late permission, denial, recorder failure and bounds. CI runs the same tests
on Linux/Windows/macOS. Real Chromium page tests use Playwright's synthetic devices
and synthetic permission grants to verify Start, recording, local artifact/hash
and Stop. These tests do not open physical cameras or microphones or alter the
owner's browser permissions.

## Failed / remains

Exact-head CI and remote readback must pass before acceptance. Real hardware,
browser/OS permission denial/revoke, playback, Stop/offline, Windows ACLs, supported
browser codecs, signed installation and useful-owner acceptance remain. No silent
permission automation, device job, installation, cloud upload or live deployment.

CEO dispatch, authorized media ingestion/accounting, screen/OS mouse/keyboard
executor and real Windows/macOS/Linux acceptance are separate stages. Existing
browser/file/Stop functionality stays unchanged. No Mem0 service is installed by
this module; prior Mem0 accounting/publication stages remain in the master plan.
The owner specifically asked to leave the troubled Mac/Debian installation alone.

Local browser-download verification was blocked by truncated Chromium archives
from the download endpoint. The Node tests passed; actual browser coverage must
be established by the dedicated exact-head CI, not inferred from those tests.

Standards: [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/),
[MediaStream Recording](https://www.w3.org/TR/mediastream-recording/).
