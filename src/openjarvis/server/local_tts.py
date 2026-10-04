"""Bounded local Piper speech for Firbo's no-paid-fallback voice path.

The Piper service is private-network only. This module never calls a paid/cloud
TTS provider. Seven server voices use commercial-safe CC0/public-domain source
datasets. Arabic intentionally returns a device-fallback signal until a
commercially safe server voice is approved.
"""
from __future__ import annotations
from array import array
import io
import os
import sys
import wave
import httpx
from openjarvis.server.free_inference import FreeError

PIPER_URL = "http://firbo-piper:5000"
VOICE_BY_LANG = {
    "en": "en_US-joe-medium",
    "el": "el_GR-rapunzelina-low",
    "es": "es_ES-davefx-medium",
    "pt-BR": "pt_BR-cadu-medium",
    "fr": "fr_FR-gilles-low",
    "de": "de_DE-thorsten-medium",
    "zh-CN": "zh_CN-chaowen-medium",
}
SUPPORTED = frozenset((*VOICE_BY_LANG, "ar"))
MAX_TEXT = 700
MAX_WAV = 6_000_000

async def _read_bounded(response: httpx.Response, maximum: int = MAX_WAV) -> bytes:
    total = 0
    parts: list[bytes] = []
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > maximum:
            raise FreeError("local_voice_too_large", 502)
        parts.append(chunk)
    return b"".join(parts)

def darken_wav(raw: bytes) -> bytes:
    """Lower pitch/speed slightly and add gentle low-pass body using stdlib only."""
    if len(raw) < 44 or not raw.startswith(b"RIFF") or raw[8:12] != b"WAVE":
        raise FreeError("local_voice_invalid_audio", 502)
    try:
        with wave.open(io.BytesIO(raw), "rb") as src:
            if src.getnchannels() != 1 or src.getsampwidth() != 2 or src.getcomptype() != "NONE":
                raise FreeError("local_voice_invalid_audio", 502)
            rate = src.getframerate()
            frames = src.readframes(src.getnframes())
    except (wave.Error, EOFError):
        raise FreeError("local_voice_invalid_audio", 502) from None
    samples = array("h")
    samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        raise FreeError("local_voice_invalid_audio", 502)

    ratio = 0.90
    out_count = max(1, int(len(samples) / ratio))
    filtered = array("h")
    prev = 0.0
    for i in range(out_count):
        pos = min(i * ratio, len(samples) - 1)
        a = int(pos)
        frac = pos - a
        b = min(a + 1, len(samples) - 1)
        x = samples[a] + (samples[b] - samples[a]) * frac
        prev += 0.23 * (x - prev)
        mixed = 0.82 * x + 0.18 * prev
        filtered.append(max(-32768, min(32767, int(mixed * 0.92))))
    if sys.byteorder != "little":
        filtered.byteswap()
    target = io.BytesIO()
    with wave.open(target, "wb") as dst:
        dst.setnchannels(1); dst.setsampwidth(2); dst.setframerate(rate)
        dst.writeframes(filtered.tobytes())
    value = target.getvalue()
    if len(value) > MAX_WAV:
        raise FreeError("local_voice_too_large", 502)
    return value

async def local_speech(text: str, lang: str) -> tuple[bytes, str]:
    clean = " ".join(text.split()).strip()
    if not clean or len(clean) > MAX_TEXT or lang not in SUPPORTED:
        raise FreeError("local_voice_bad_request", 400)
    voice = VOICE_BY_LANG.get(lang)
    if not voice:
        # Arabic device TTS is zero-API-cost but device-dependent. Do not use
        # the known non-commercial/unclear Piper Arabic datasets for customers.
        raise FreeError("local_voice_device_fallback", 409)
    if os.environ.get("FIRBO_LOCAL_VOICE_ENABLED") != "true":
        raise FreeError("local_voice_disabled", 503)
    try:
        timeout = httpx.Timeout(25.0, connect=2.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
            async with client.stream("POST", PIPER_URL + "/synthesize",
                json={"text": clean, "voice": voice, "length_scale": 1.04}) as response:
                if response.status_code != 200:
                    raise FreeError("local_voice_unavailable", 503)
                ctype = response.headers.get("content-type", "").split(";")[0]
                if ctype not in {"audio/wav", "audio/x-wav", "application/octet-stream"}:
                    raise FreeError("local_voice_invalid_audio", 502)
                raw = await _read_bounded(response)
    except FreeError:
        raise
    except (httpx.HTTPError, TimeoutError):
        raise FreeError("local_voice_unavailable", 503) from None
    return darken_wav(raw), voice
