import io
import os
import sys
import wave
from array import array

import pytest

sys.path.insert(0, "src")
from openjarvis.server.local_tts import SUPPORTED, VOICE_BY_LANG, FreeError, darken_wav


def wav(samples=1600, rate=16000):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        a = array("h", [int(7000 * ((i % 80) / 80 - 0.5)) for i in range(samples)])
        if sys.byteorder != "little":
            a.byteswap()
        w.writeframes(a.tobytes())
    return b.getvalue()


def test_all_firbo_locales_have_zero_api_cost_route():
    assert SUPPORTED == {"en", "el", "es", "pt-BR", "fr", "de", "zh-CN", "ar"}
    assert set(VOICE_BY_LANG) == SUPPORTED - {"ar"}


def test_server_voice_ids_are_exact_and_no_cloud():
    assert VOICE_BY_LANG == {
        "en": "en_US-joe-medium",
        "el": "el_GR-rapunzelina-low",
        "es": "es_ES-davefx-medium",
        "pt-BR": "pt_BR-cadu-medium",
        "fr": "fr_FR-gilles-low",
        "de": "de_DE-thorsten-medium",
        "zh-CN": "zh_CN-chaowen-medium",
    }


def test_dark_wav_is_real_longer_audio():
    source = wav()
    result = darken_wav(source)
    assert result[:4] == b"RIFF" and result[8:12] == b"WAVE"
    with (
        wave.open(io.BytesIO(source), "rb") as a,
        wave.open(io.BytesIO(result), "rb") as b,
    ):
        assert b.getnframes() > a.getnframes()
        assert b.getframerate() == a.getframerate()
        assert b.getnchannels() == 1 and b.getsampwidth() == 2


@pytest.mark.parametrize("bad", [b"", b"{}", b"RIFFbad"])
def test_bad_audio_rejected(bad):
    with pytest.raises(FreeError):
        darken_wav(bad)
