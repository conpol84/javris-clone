#!/usr/bin/env python3
"""Guarded catalogue registration, NOT free inference or production deployment.

Use beside the SHA-pinned free_models.py helper. Default is a read-only plan;
--apply appends missing catalogue rows for already-connected providers only.
Quota pools block writes BEFORE registration: model writes can trigger their
routing hooks. No prompts, AI calls, provider connections or secret rotation.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import time
import types
import urllib.error
import urllib.request
from typing import Any

HELPER_SHA256 = '0cf5cd914ddf47f61d382eeb5fc1c861a45c3b6f9415d7dd6f9b1b5063fb46e2'
POOL_URL = 'https://gateway.firboai.app/api/quota/pools?limit=200'
PRICE_MAX_AGE_SECONDS = 300


def load_helper() -> Any:
    # Compile the bytes whose checksum was checked, avoiding a second file read.
    source = Path(__file__).with_name('free_models.py')
    with source.open('rb') as stream:
        data = stream.read(128 * 1024 + 1)
    if len(data) > 128 * 1024 or hashlib.sha256(data).hexdigest() != HELPER_SHA256:
        raise ValueError('helper_checksum_mismatch')
    module = types.ModuleType('_firbo_free_catalogue_pinned')
    module.__file__ = str(source)
    exec(compile(data, str(source), 'exec'), module.__dict__)
    return module


def read_pools(f: Any, key: str) -> Any:
    """One fixed management GET; never print bodies, headers or raw exceptions."""
    f.require(key and not any(ord(c) < 32 for c in key), 'invalid_management_credential')
    request = urllib.request.Request(POOL_URL, headers={
        'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
        'Cache-Control': 'no-cache', 'User-Agent': 'Firbo-Free-Guard/1',
    })
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), f.NoRedirect())
        with opener.open(request, timeout=20) as response:
            f.require(response.status == 200, 'quota_pool_check_unavailable')
            f.require('json' in response.headers.get('Content-Type', ''), 'quota_pool_contract_invalid')
            body = response.read(f.MAX_BYTES + 1)
            f.require(len(body) <= f.MAX_BYTES, 'quota_pool_response_too_large')
            return json.loads(body)
    except urllib.error.HTTPError:
        raise f.Blocked('quota_pool_check_unavailable') from None
    except (OSError, ValueError, urllib.error.URLError):
        raise f.Blocked('quota_pool_check_unavailable') from None


def require_no_pools(f: Any, payload: Any) -> None:
    pools = f.rows(payload, 'pools', 200)
    # No implicit empty default, truncated catalogue or unknown response accepted.
    f.require(type(payload.get('total')) is int and payload['total'] == len(pools),
              'quota_pool_pagination_incomplete')
    f.require(not pools, 'quota_pools_present_registration_requires_review')


@contextmanager
def registration_lock(f: Any):
    # A per-VPS lock prevents two copies of THIS tool from writing concurrently.
    # It is not a distributed lock over other administrators or gateway jobs.
    root = f.JOURNAL_ROOT
    f.require(root.resolve() == root, 'unsafe_registration_lock')
    if not root.exists():
        root.mkdir(mode=0o700)
    meta = root.lstat()
    f.require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == os.geteuid()
              and stat.S_IMODE(meta.st_mode) & 0o077 == 0, 'unsafe_registration_lock')
    fd = os.open(root / 'registration.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        f.require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                  and stat.S_IMODE(info.st_mode) & 0o077 == 0, 'unsafe_registration_lock')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise f.Blocked('another_catalogue_registration_running') from None
        yield
    finally:
        os.close(fd)


def verify_preserved(f: Any, original: dict[str, Any], current: dict[str, Any]) -> None:
    for provider, before in original.items():
        f.require(before.get('hiddenModelsByProvider', {}) == current[provider].get('hiddenModelsByProvider', {}),
                  'hidden_models_changed_review_required')
        after_rows = f.rows(current[provider], 'models')
        for old in f.rows(before, 'models'):
            f.require(any(old == new for new in after_rows), 'existing_model_changed_review_required')


def run(f: Any, apply: bool = False, pool_reader=read_pools) -> tuple[dict[str, Any], int]:
    report: dict[str, Any] = {
        'contract': 'firbo-free-catalogue-guard/v1', 'status': 'blocked',
        'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'inference_requests': 0, 'report_contains_secrets': False,
        'runtime_deployment_performed': False, 'agent_settings_write_requested': False,
        'writes_may_have_occurred': False, 'registered_models': [],
        'limitations': f.LIMITATIONS + [
            'Quota-pool guard is a preflight, not a distributed gateway transaction.',
            'Do not edit provider, model or routing settings concurrently with this tool.',
        ],
    }
    journal = None
    try:
        report.update(f.discover())
        discovered_at = time.monotonic()
        f.require(report['offers'], 'no_verified_free_offers')
        key, runtime_before = f.runtime()
        call = lambda path, body=None: f.gateway(key, path, body)
        active = f.active_providers(call('/api/providers?limit=200'))
        report['connected_supported_providers'] = sorted(active)
        report['requires_provider_connection'] = sorted(set(f.PROVIDERS) - active)
        f.require(not (active & set(report['source_errors'])), 'connected_provider_price_source_unavailable')
        custom = {p: call('/api/provider-models?provider=' + p) for p in active}
        plan = f.registration_plan(report['offers'], active, custom, call('/v1/models'))
        report['proposed_additions'] = plan
        if not plan:
            report['status'] = 'no_new_models_for_connected_providers'
            return report, 0
        require_no_pools(f, pool_reader(f, key))
        report['quota_pools_absent_before_registration'] = True
        if not apply:
            report['status'] = 'guarded_plan_ready'
            return report, 0

        with registration_lock(f):
            before_combos = call('/api/combos?limit=200')
            combos = f.rows(before_combos, 'combos', 200)
            f.require(before_combos.get('total', len(combos)) == len(combos), 'combo_pagination_incomplete')
            combo_hash = f.fingerprint(combos)
            journal = f.Journal()
            report['journal_path'] = journal.path
            journal.write({'phase': 'before', 'plan': plan, 'checked_at': report['checked_at'],
                           'custom_digest': f.fingerprint(custom), 'combos_digest': combo_hash})

            def check_boundary() -> None:
                f.require(time.monotonic() - discovered_at <= PRICE_MAX_AGE_SECONDS, 'price_snapshot_expired_rerun_plan')
                require_no_pools(f, pool_reader(f, key))
                f.require(f.runtime()[1] == runtime_before, 'runtime_changed_review_required')
                f.require(f.active_providers(call('/api/providers?limit=200')) == active, 'provider_connections_changed_review_required')
                now = call('/api/combos?limit=200')
                now_rows = f.rows(now, 'combos', 200)
                f.require(now.get('total', len(now_rows)) == len(now_rows), 'combo_pagination_incomplete')
                f.require(f.fingerprint(now_rows) == combo_hash, 'combos_changed_review_required')
                current = {p: call('/api/provider-models?provider=' + p) for p in active}
                verify_preserved(f, custom, current)

            for item in plan:
                check_boundary()

                def guarded_call(path: str, body: Any = None) -> Any:
                    if body is not None:
                        f.require(path == '/api/provider-models'
                                  and body.get('provider') == item['provider']
                                  and body.get('modelId') == item['model_id'], 'write_outside_registration_plan')
                        # Check again immediately before this individual catalogue POST.
                        check_boundary()
                        fresh = {p: call('/api/provider-models?provider=' + p) for p in active}
                        still_planned = f.registration_plan([item], active, fresh, call('/v1/models'))
                        f.require(bool(still_planned), 'model_selection_changed_review_required')
                        report['writes_may_have_occurred'] = True
                    return call(path, body)

                f.register([item], guarded_call, journal, report['registered_models'])
                check_boundary()
            report['existing_combos_unchanged'] = True
            report['runtime_unchanged'] = True
            report['status'] = 'catalogue_registered_execution_unverified'
            journal.write({'phase': 'complete', 'registered_models': report['registered_models']})
        return report, 0
    except f.Blocked as exc:
        report['error'] = str(exc)
    except Exception:
        report['error'] = 'guard_failed_review_journal_if_present'
    finally:
        if journal is not None:
            try:
                journal.close()
            except OSError:
                pass
    return report, 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        helper = load_helper()
    except Exception:
        print(json.dumps({'contract': 'firbo-free-catalogue-guard/v1', 'status': 'blocked',
                          'error': 'helper_missing_or_checksum_mismatch', 'writes_may_have_occurred': False}))
        raise SystemExit(1)
    result, exit_code = run(helper, args.apply)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(exit_code)
