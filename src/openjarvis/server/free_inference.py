"""Bounded, no-paid-route text inference for an explicitly enabled Firbo pilot.

No tool execution, audio, paid keys, arbitrary URLs, or general OmniRoute combos.
SQLite coordination is for ONE host/shared local database, not multiple replicas.
Provider prices/terms are external promises; only self-hosting removes that dependency.
"""
from __future__ import annotations
import asyncio
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from typing import Any
from uuid import UUID, uuid4
import httpx

LOCAL_URL = 'http://firbo-ollama:11434'
CLOUD_URL = 'https://openrouter.ai/api/v1'
MAX_INPUT_BYTES = 2800
MAX_OUTPUT = 512
TOTAL_TIMEOUT = 90
LOCAL_MODELS = frozenset({'qwen3:1.7b', 'qwen3:4b', 'qwen3:8b'})

class FreeError(Exception):
    def __init__(self, code: str, status: int = 503):
        self.code, self.status = code, status
        super().__init__(code)

@dataclass(frozen=True)
class Route:
    kind: str
    model: str
    # One account's different models share a pool. Keys never appear in repr/logs.
    key: str = field(default='', repr=False, compare=False)
    def __post_init__(self):
        if self.kind == 'ollama':
            if self.model not in LOCAL_MODELS or self.key: raise FreeError('local_model_not_reviewed')
        elif self.kind == 'openrouter':
            if not re.fullmatch(r'[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+:free', self.model):
                raise FreeError('paid_or_automatic_model_denied')
            if not self.key or len(self.key) > 512 or re.search(r'\s', self.key): raise FreeError('free_key_missing')
        else: raise FreeError('provider_not_reviewed')
    @property
    def pool(self): return self.kind  # Deliberately one pool/account per provider.

@dataclass(frozen=True)
class Limits:
    user_daily: int = 20
    org_daily: int = 100
    global_daily: int = 500
    global_parallel: int = 2
    def __post_init__(self):
        if any(type(v) is not int or not 1 <= v <= 100_000 for v in vars(self).values()):
            raise FreeError('invalid_free_limits')
        if self.global_parallel > 8: raise FreeError('invalid_free_parallelism')

class Ledger:
    """Atomic admission, idempotency and pool leases. No prompts/answers/secrets stored."""
    def __init__(self, path: str, limits: Limits = Limits()):
        self.path, self.limits = path, limits
        p = Path(path)
        if not p.is_absolute() or p.parent.resolve() != p.parent or not p.parent.is_dir():
            raise FreeError('free_ledger_directory_required')
        if p.parent.stat().st_mode & 0o077: raise FreeError('free_ledger_directory_not_private')
        fd = os.open(p, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            if os.fstat(fd).st_mode & 0o077: raise FreeError('free_ledger_not_private')
        finally: os.close(fd)
        with self.tx() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS requests(
              org TEXT NOT NULL, rid TEXT NOT NULL, uid TEXT NOT NULL, day TEXT NOT NULL,
              started REAL NOT NULL, state TEXT NOT NULL, route TEXT, input_tokens INTEGER,
              output_tokens INTEGER, PRIMARY KEY(org,rid));
            CREATE INDEX IF NOT EXISTS request_daily ON requests(day,org,uid);
            CREATE TABLE IF NOT EXISTS leases(pool TEXT PRIMARY KEY, token TEXT NOT NULL, until REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS cooldowns(pool TEXT PRIMARY KEY, until REAL NOT NULL);
            ''')
    @contextmanager
    def tx(self):
        db = sqlite3.connect(self.path, timeout=2, isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            if db.in_transaction: db.commit()
        except BaseException:
            if db.in_transaction: db.rollback()
            raise
        finally: db.close()
    def admit(self, org: str, uid: str, rid: str, now: float):
        for value in (org, uid, rid):
            try:
                if str(UUID(value)) != value.lower(): raise ValueError()
            except (ValueError, TypeError, AttributeError): raise FreeError('invalid_request_identity', 400) from None
        day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
        with self.tx() as db:
            if db.execute('SELECT 1 FROM requests WHERE org=? AND rid=?', (org,rid)).fetchone():
                raise FreeError('request_already_admitted', 409)
            # Stale work is recorded as uncertain, NEVER automatically replayed.
            db.execute("UPDATE requests SET state='unknown' WHERE state='running' AND started<?", (now-180,))
            count = lambda sql, args=(): db.execute(sql, args).fetchone()[0]
            if count("SELECT COUNT(*) FROM requests WHERE state='running'") >= self.limits.global_parallel:
                raise FreeError('free_capacity_busy', 429)
            queries = [("day=? AND uid=?", (day,uid), self.limits.user_daily),
                       ("day=? AND org=?", (day,org), self.limits.org_daily),
                       ("day=?", (day,), self.limits.global_daily)]
            if any(count('SELECT COUNT(*) FROM requests WHERE '+q,a) >= cap for q,a,cap in queries):
                raise FreeError('free_daily_limit', 429)
            db.execute('INSERT INTO requests(org,rid,uid,day,started,state) VALUES(?,?,?,?,?,?)', (org,rid,uid,day,now,'running'))
    def acquire(self, pool: str, now: float) -> str | None:
        with self.tx() as db:
            row = db.execute('SELECT until FROM cooldowns WHERE pool=?', (pool,)).fetchone()
            if row and row[0] > now: return None
            db.execute('DELETE FROM leases WHERE pool=? AND until<=?', (pool,now))
            if db.execute('SELECT 1 FROM leases WHERE pool=?', (pool,)).fetchone(): return None
            token = str(uuid4())
            db.execute('INSERT INTO leases VALUES(?,?,?)', (pool,token,now+180))
            return token
    def release(self, pool: str, token: str):
        with self.tx() as db: db.execute('DELETE FROM leases WHERE pool=? AND token=?', (pool,token))
    def cool(self, pool: str, until: float):
        with self.tx() as db:
            db.execute('INSERT INTO cooldowns VALUES(?,?) ON CONFLICT(pool) DO UPDATE SET until=MAX(cooldowns.until,excluded.until)', (pool,until))
    def finish(self, org: str, rid: str, state: str, route: str | None = None, usage: tuple[int,int] | None = None):
        with self.tx() as db:
            db.execute('UPDATE requests SET state=?,route=?,input_tokens=?,output_tokens=? WHERE org=? AND rid=?',
                       (state,route,*(usage or (None,None)),org,rid))

def retry_seconds(raw: str | None, now: float, default: int = 60) -> float:
    """No busy retry loop. Extremely long Retry-After remains respected up to a day."""
    try:
        value = float(raw) if raw and raw.isdigit() else parsedate_to_datetime(raw).timestamp()-now
        return max(1, min(86_400, value))
    except (TypeError, ValueError, OverflowError): return default

async def read_json(response: httpx.Response, limit: int) -> Any:
    body = bytearray()
    if response.headers.get('content-type','').split(';')[0].lower() != 'application/json':
        raise FreeError('free_invalid_response', 502)
    async for part in response.aiter_bytes():
        if len(body)+len(part) > limit: raise FreeError('free_response_too_large', 502)
        body.extend(part)
    try: return json.loads(body)
    except (ValueError, UnicodeError): raise FreeError('free_invalid_response', 502) from None

def all_prices_zero(pricing: Any) -> bool:
    if not isinstance(pricing,dict) or not {'prompt','completion'} <= pricing.keys(): return False
    try:
        # Every price dimension supplied by the provider must be an explicit finite zero.
        return all(not isinstance(v,bool) and v is not None and Decimal(str(v)).is_finite() and Decimal(str(v))==0 for v in pricing.values())
    except (InvalidOperation, ValueError): return False

def normalize_completion(data: Any, route: Route) -> tuple[str,int,int,bool]:
    try:
        if not isinstance(data,dict) or data.get('error'): raise ValueError()
        if route.kind == 'ollama':
            if data.get('done') is not True or data.get('model') != route.model: raise ValueError()
            message, a, b = data['message'], data['prompt_eval_count'], data['eval_count']
            end = data.get('done_reason','stop')
        else:
            choice = data['choices'][0]
            message, a, b = choice['message'], data['usage']['prompt_tokens'], data['usage']['completion_tokens']
            end = choice['finish_reason']
            if 'cost' in data['usage'] and not all_prices_zero({'prompt':0,'completion':0,'cost':data['usage']['cost']}):
                raise FreeError('free_charge_discrepancy',502)
        # Do not evade moderation/refusal by switching providers. No tools in this lane.
        if end not in {'stop','length'} or message.get('tool_calls') or message.get('refusal'):
            raise FreeError('free_response_not_text', 422)
        text = message['content']
        if not isinstance(text,str) or not text.strip() or len(text.encode())>64_000: raise ValueError()
        if any(type(v) is not int or not 0 <= v <= 1_000_000 for v in (a,b)): raise ValueError()
        return text,a,b,end=='length'
    except (KeyError, IndexError, TypeError, ValueError): raise FreeError('free_invalid_completion', 502) from None

class FreeEngine:
    def __init__(self, routes: list[Route], ledger: Ledger, *, transport=None, clock=time.time, max_output=MAX_OUTPUT, context_tokens=4096, threads=1):
        if not routes or len(routes)>4 or len({(r.kind,r.model) for r in routes})!=len(routes):
            raise FreeError('invalid_free_routes')
        if len({r.key for r in routes if r.kind=='openrouter'})>1: raise FreeError('one_provider_account_only')
        if type(max_output) is not int or not 32 <= max_output <= MAX_OUTPUT or type(context_tokens) is not int or not 1024 <= context_tokens <= 4096 or type(threads) is not int or not 1 <= threads <= 4:
            raise FreeError('invalid_local_runtime_limits')
        self.max_output, self.context_tokens, self.threads = max_output, context_tokens, threads
        self.routes, self.ledger, self.transport, self.clock = tuple(routes), ledger, transport, clock
    async def infer(self, org: str, uid: str, rid: str, messages: list[dict[str,str]], *, cloud_allowed: bool = False):
        if not isinstance(messages,list) or not 1 <= len(messages)<=24: raise FreeError('invalid_free_messages',400)
        if any(not isinstance(m,dict) or set(m)!={'role','content'} or m['role'] not in {'system','user','assistant'} or not isinstance(m['content'],str) for m in messages):
            raise FreeError('invalid_free_messages',400)
        if len(json.dumps(messages,ensure_ascii=False).encode())>MAX_INPUT_BYTES: raise FreeError('free_context_too_large',413)
        self.ledger.admit(org,uid,rid,self.clock())
        state, route_used, counts, attempts = 'failed',None,None,0
        try:
            async with asyncio.timeout(TOTAL_TIMEOUT):
                async with httpx.AsyncClient(transport=self.transport,timeout=httpx.Timeout(40,connect=3),follow_redirects=False,trust_env=False) as client:
                    for route in self.routes:
                        if route.kind!='ollama' and not cloud_allowed: continue
                        token = self.ledger.acquire(route.pool,self.clock())
                        if token is None: continue
                        try:
                            if route.kind=='openrouter':
                                # Discovery is not a paid inference. Fail closed if prices are missing/change.
                                async with client.stream('GET',CLOUD_URL+'/models') as response:
                                    if response.status_code != 200:
                                        self.ledger.cool(route.pool,self.clock()+60);continue
                                    catalog = await read_json(response,4_000_000)
                                if not isinstance(catalog,dict) or not isinstance(catalog.get('data'),list): raise FreeError('free_price_verification_unavailable')
                                found=[m for m in catalog['data'] if isinstance(m,dict) and m.get('id')==route.model]
                                if len(found)!=1 or not all_prices_zero(found[0].get('pricing')):
                                    self.ledger.cool(route.pool,self.clock()+300);continue
                                endpoint=CLOUD_URL+'/chat/completions'
                                headers={'Authorization':'Bearer '+route.key}
                                body={'model':route.model,'messages':messages,'max_tokens':self.max_output,'stream':False,
                                      'provider':{'allow_fallbacks':False,'data_collection':'deny',
                                                  'max_price':{'prompt':0,'completion':0,'request':0,'image':0}}}
                            else:
                                endpoint=LOCAL_URL+'/api/chat';headers={}
                                body={'model':route.model,'messages':messages,'stream':False,'think':False,'keep_alive':'2m',
                                      'options':{'num_ctx':self.context_tokens,'num_predict':self.max_output,'num_thread':self.threads,'temperature':0.4}}
                            attempts += 1
                            async with client.stream('POST',endpoint,headers=headers,json=body) as response:
                                if response.status_code in {429,503}:
                                    self.ledger.cool(route.pool,self.clock()+retry_seconds(response.headers.get('retry-after'),self.clock(),60 if response.status_code==429 else 15))
                                    continue
                                if response.status_code in {401,402,403}: raise FreeError('free_provider_access_denied')
                                if response.status_code != 200: raise FreeError('free_provider_rejected',502)
                                data = await read_json(response,128_000)
                            text,a,b,truncated=normalize_completion(data,route)
                            state,route_used,counts='completed',route.kind+':'+route.model,(a,b)
                            return {'choices':[{'message':{'role':'assistant','content':text},'finish_reason':'length' if truncated else 'stop'}],
                                    'model':route_used,'usage':{'prompt_tokens':a,'completion_tokens':b},
                                    'firbo':{'contract':'firbo-free-text/v1','request_id':rid,'attempts':attempts,
                                      'policy':'no-paid-fallback','provider_fee_usd':0,
                                      'cost_basis':'self_hosted_no_metered_fee' if route.kind=='ollama' else 'verified_free_api',
                                      'infrastructure_cost_excluded':True}}
                        finally: self.ledger.release(route.pool,token)
                    raise FreeError('free_capacity_unavailable',429)
        except (TimeoutError,httpx.HTTPError):
            # An uncertain/partial request cannot silently launch another generation.
            state='unknown'
            raise FreeError('free_transport_uncertain',504) from None
        except asyncio.CancelledError:
            state='cancelled';raise
        finally:
            self.ledger.finish(org,rid,state,route_used,counts)
