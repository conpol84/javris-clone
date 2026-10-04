"""Private production-side Piper server for Firbo local voice."""
from __future__ import annotations
from http.server import BaseHTTPRequestHandler, HTTPServer
import io, json, os, threading, wave
from pathlib import Path
from piper import PiperVoice, SynthesisConfig

HOST=os.environ.get("FIRBO_PIPER_HOST","0.0.0.0")
PORT=int(os.environ.get("FIRBO_PIPER_PORT","5000"))
DATA=Path(os.environ.get("FIRBO_PIPER_DATA","/voices"))
MAX_BODY=16_384; MAX_TEXT=700; MAX_WAV=6_000_000
VOICES=frozenset({"en_US-joe-medium","el_GR-rapunzelina-low","es_ES-davefx-medium","pt_BR-cadu-medium","fr_FR-gilles-low","de_DE-thorsten-medium","zh_CN-chaowen-medium"})

class VoiceStore:
    def __init__(self): self.name=None; self.voice=None; self.lock=threading.Lock()
    def synth(self,name,text,length):
        if name not in VOICES: raise ValueError("voice_not_allowed")
        model=DATA/f"{name}.onnx"; config=DATA/f"{name}.onnx.json"
        if not model.is_file() or not config.is_file(): raise RuntimeError("voice_missing")
        with self.lock:
            if self.name!=name:
                self.voice=PiperVoice.load(
                    str(model),config_path=str(config),use_cuda=False,
                    download_dir=os.environ.get("FIRBO_PIPER_RESOURCES","/opt/firbo-resources"),
                )
                self.name=name
            target=io.BytesIO()
            with wave.open(target,"wb") as wav:
                self.voice.synthesize_wav(text,wav,syn_config=SynthesisConfig(length_scale=length))
            raw=target.getvalue()
            if len(raw)>MAX_WAV or raw[:4]!=b"RIFF" or raw[8:12]!=b"WAVE": raise RuntimeError("invalid_audio")
            return raw
STORE=VoiceStore()

class Handler(BaseHTTPRequestHandler):
    server_version="FirboPiper/1"
    def log_message(self,fmt,*args):
        print(json.dumps({"event":"firbo_piper_http","method":self.command,"path":self.path}),flush=True)
    def reply_json(self,status,value):
        raw=json.dumps(value,separators=(",",":")).encode()
        self.send_response(status); self.send_header("Content-Type","application/json"); self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def do_GET(self):
        if self.path!="/health": return self.reply_json(404,{"error":"not_found"})
        ready=[v for v in sorted(VOICES) if (DATA/f"{v}.onnx").is_file() and (DATA/f"{v}.onnx.json").is_file()]
        self.reply_json(200,{"contract":"firbo-piper/v1","ready":len(ready)==len(VOICES),"voices":ready})
    def do_POST(self):
        if self.path!="/synthesize": return self.reply_json(404,{"error":"not_found"})
        try:
            n=int(self.headers.get("Content-Length","-1"))
            if n<2 or n>MAX_BODY: raise ValueError
            body=json.loads(self.rfile.read(n))
            if not isinstance(body,dict) or set(body)-{"text","voice","length_scale"}: raise ValueError
            text=" ".join(str(body.get("text","")).split()).strip(); voice=body.get("voice"); scale=float(body.get("length_scale",1.04))
            if not text or len(text)>MAX_TEXT or not isinstance(voice,str) or voice not in VOICES or not .85<=scale<=1.25: raise ValueError
            raw=STORE.synth(voice,text,scale)
        except (ValueError,json.JSONDecodeError): return self.reply_json(400,{"error":"bad_request"})
        except Exception: return self.reply_json(503,{"error":"voice_unavailable"})
        self.send_response(200); self.send_header("Content-Type","audio/wav"); self.send_header("Cache-Control","private, no-store")
        self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)

if __name__=="__main__":
    if PORT<1 or PORT>65535: raise SystemExit("invalid_port")
    HTTPServer((HOST,PORT),Handler).serve_forever()
