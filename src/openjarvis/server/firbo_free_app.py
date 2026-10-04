"""Opt-in wrapper for the existing Firbo API; NOT the installed production entrypoint.

Keeps the native control app/guards unchanged. Select this entrypoint only after
Ollama sizing, pinned model installation, private network and exact-company tests.
"""
from __future__ import annotations
from functools import lru_cache
import os
import sqlite3
import re
import httpx
from uuid import UUID
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from openjarvis.server.firbo_app import create_app
from openjarvis.server.firbo_control import Principal, require_user, _supabase, _platform_admin, require_platform_admin
from openjarvis.server.free_inference import FreeEngine, FreeError, Ledger, Limits, Route, LOCAL_URL, read_json

class Message(BaseModel):
    model_config = ConfigDict(extra='forbid')
    role: str = Field(max_length=10)
    content: str = Field(max_length=2800)
class FreeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    organization_id: UUID
    request_id: UUID
    messages: list[Message] = Field(min_length=1,max_length=24)

def organizations(name: str) -> set[str]:
    raw=os.environ.get(name,'')
    if len(raw)>10_000: raise FreeError('free_company_configuration_invalid')
    try: return {str(UUID(s.strip())) for s in raw.split(',') if s.strip()}
    except ValueError: raise FreeError('free_company_configuration_invalid') from None

@lru_cache(maxsize=1)
def engine() -> FreeEngine:
    models=[m.strip() for m in os.environ.get('FIRBO_FREE_LOCAL_MODELS','').split(',') if m.strip()]
    routes=[Route('ollama',m) for m in models]
    cloud=[m.strip() for m in os.environ.get('FIRBO_FREE_OPENROUTER_MODELS','').split(',') if m.strip()]
    if cloud:
        if os.environ.get('FIRBO_FREE_CLOUD_REVIEWED')!='true': raise FreeError('free_cloud_review_required')
        routes += [Route('openrouter',m,os.environ.get('FIRBO_FREE_OPENROUTER_KEY','')) for m in cloud]
    # Local-first by default. An explicit operator setting may prefer reviewed cloud.
    if os.environ.get('FIRBO_FREE_CLOUD_FIRST')=='true': routes.sort(key=lambda r:r.kind=='ollama')
    path=os.environ.get('FIRBO_FREE_LEDGER','')
    if not path: raise FreeError('free_ledger_directory_required')
    # Current 2-vCPU/8GiB deployment: reserve capacity for the existing stack.
    return FreeEngine(routes,Ledger(path,Limits(global_parallel=1)),max_output=128,context_tokens=2048,threads=1)

def create_free_app():
    app=create_app()
    @app.get('/v1/firbo/free/status')
    async def status(principal: Principal=Depends(require_platform_admin)):
        enabled=os.environ.get('FIRBO_FREE_ENABLED')=='true'
        expected=os.environ.get('FIRBO_FREE_MODEL_DIGEST','')
        ready=False
        error='not_installed'
        if enabled and re.fullmatch(r'[a-f0-9]{64}',expected):
            try:
                async with httpx.AsyncClient(timeout=3,follow_redirects=False,trust_env=False) as client:
                    async with client.stream('GET',LOCAL_URL+'/api/tags') as res:
                        if res.status_code==200:
                            value=await read_json(res,32000)
                            ready=any(m.get('name')=='qwen3:1.7b' and m.get('digest')==expected for m in value.get('models',[]) if isinstance(m,dict))
                error=None if ready else 'model_identity_unverified'
            except Exception:
                error='local_engine_unreachable'
        return {'contract':'firbo-local-status/v1','enabled':enabled,'ready':ready,'error':error,
                'model':'qwen3:1.7b','scope':'platform-admin-pilot','policy':'no-paid-fallback',
                'max_output_tokens':128,'context_tokens':2048,'parallel':1,'infrastructure_cost_excluded':True}

    @app.post('/v1/firbo/free/chat/completions')
    async def chat(body: FreeRequest, principal: Principal=Depends(require_user)):
        try:
            if os.environ.get('FIRBO_FREE_ENABLED')!='true': raise FreeError('free_runtime_disabled')
            org=str(body.organization_id)
            if org not in organizations('FIRBO_FREE_ORGANIZATIONS'):
                # Installer enables ONLY the existing platform administrator pilot.
                # This flag is server-owned, not JWT user_metadata or a browser field.
                if os.environ.get('FIRBO_FREE_ADMIN_PILOT')!='true' or not await _platform_admin(principal):
                    raise FreeError('free_company_not_enabled',403)
            rows=await _supabase(principal,'/rest/v1/organization_members?select=organization_id,user_id,role'
                f'&organization_id=eq.{org}&user_id=eq.{principal.user_id}&limit=2')
            if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict):
                raise FreeError('free_membership_required',403)
            row=rows[0]
            if row.get('organization_id')!=org or row.get('user_id')!=principal.user_id or row.get('role') not in {'owner','admin','manager','member'}:
                raise FreeError('free_membership_required',403)
            return await engine().infer(org,principal.user_id,str(body.request_id),[m.model_dump() for m in body.messages],
                    cloud_allowed=org in organizations('FIRBO_FREE_CLOUD_ORGANIZATIONS'))
        except FreeError as exc: raise HTTPException(exc.status,exc.code) from None
        except (sqlite3.Error,OSError): raise HTTPException(503,'free_state_unavailable') from None
    return app

app=create_free_app()
