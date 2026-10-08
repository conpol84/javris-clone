#!/usr/bin/env python3
"""Read-only capacity snapshot on the CURRENT VPS. No network, keys or inference.
Does not install Ollama, pull images/models, inspect environment variables or
restart services. Numbers describe available resources, not benchmarked users/sec.
"""
from __future__ import annotations
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
NAMES=('firbo-api','firbo-omniroute','firbo-caddy','firbo-redis','firbo-ollama')

def memory(raw):
    values={}
    for line in raw.splitlines():
        match=re.fullmatch(r'(MemTotal|MemAvailable|SwapTotal|SwapFree):\s+(\d+)\s+kB',line)
        if match:values[match[1]]=round(int(match[2])/1024**2,2)
    return values

def text(path):
    try:return Path(path).read_text()[:65536]
    except OSError:return ''

def command(args):
    try:
        r=subprocess.run(args,capture_output=True,text=True,timeout=10,check=False)
        return r.stdout[:32768] if r.returncode==0 else None
    except (OSError,subprocess.TimeoutExpired):return None

def main():
    disk=shutil.disk_usage('/');ram=memory(text('/proc/meminfo'))
    report={'contract':'firbo-local-capacity/v1','checked_at':datetime.now(timezone.utc).isoformat(),
      'read_only':True,'report_contains_secrets':False,'model_execution_performed':False,
      'host':platform.node(),'architecture':platform.machine(),'logical_cpus':os.cpu_count(),
      'available_cpu_affinity':len(os.sched_getaffinity(0)) if hasattr(os,'sched_getaffinity') else None,
      'load_1_5_15':list(os.getloadavg()) if hasattr(os,'getloadavg') else None,
      'ram_gib':ram,'root_disk_free_gib':round(disk.free/1024**3,2),
      'cgroup_memory_max':text('/sys/fs/cgroup/memory.max').strip() or 'unavailable',
      'cgroup_cpu_max':text('/sys/fs/cgroup/cpu.max').strip() or 'unavailable',
      'gpu_device_nodes_present':any(Path(p).exists() for p in ('/dev/nvidia0','/dev/kfd','/dev/dri/renderD128')),
      'nvidia_gpus':[],'container_stats':[],
      'limits':['Not an inference benchmark','GPU node presence is not usable acceleration proof','No capacity or concurrency guarantee','Reserve memory/CPU for the existing Firbo stack']}
    if shutil.which('nvidia-smi'):
        out=command(['nvidia-smi','--query-gpu=name,memory.total','--format=csv,noheader,nounits'])
        if out is not None:report['nvidia_gpus']=[line.strip()[:200] for line in out.splitlines()[:8]]
    if shutil.which('docker'):
        out=command(['docker','ps','--format','{{.Names}}'])
        names=[n for n in (out or '').splitlines() if n in NAMES]
        if names:
            stats=command(['docker','stats','--no-stream','--format','{{json .}}',*names])
            for line in (stats or '').splitlines():
                try:
                    row=json.loads(line)
                    if row.get('Name') in NAMES:
                        report['container_stats'].append({k:str(row.get(k,'unknown'))[:100] for k in ('Name','CPUPerc','MemUsage','MemPerc','PIDs')})
                except (ValueError,TypeError):pass
    print(json.dumps(report,indent=2));return 0
if __name__=='__main__':raise SystemExit(main())
