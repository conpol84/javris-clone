#!/usr/bin/env python3
"""Discover current free text offers; optionally ADD missing models to Firbo.

Default: read-only plan. --apply: append-only custom catalogue registration for
ALREADY connected OpenCode/OpenRouter providers, with a local 0600 audit journal.
No inference, account creation, token rotation, combo/agent update or restart.
A free catalogue entry is NOT a permanent price guarantee or a tested model.
"""
from __future__ import annotations

import argparse
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.error
import urllib.request
from typing import Any, Callable

SOURCES = {
    'opencode_models': 'https://opencode.ai/zen/v1/models',
    'opencode_docs': 'https://opencode.ai/docs/zen/',
    'openrouter_models': 'https://openrouter.ai/api/v1/models',
}
GATEWAY = 'https://gateway.firboai.app'
PROVIDERS = ('opencode', 'openrouter')
ALIASES = {'opencode': ('opencode', 'oc'), 'openrouter': ('openrouter', 'or')}
JOURNAL_ROOT = Path('/root/firbo-free-models')
MAX_BYTES = 16 * 1024 * 1024
MAX_ADDITIONS = 60
LIMITATIONS = [
    'Free offers and quotas may change; recheck before use.',
    'No model execution or fallback was tested by this operation.',
    'Some free providers retain prompts; do not submit personal/confidential data.',
    'No agent or existing routing profile is switched automatically.',
    'Catalogue registration alone does not enforce a runtime zero-cost policy.',
]


class Blocked(Exception):
    """Only fixed safe codes may be raised: no HTTP bodies or credentials."""


def require(ok: Any, code: str) -> None:
    if not ok:
        raise Blocked(code)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def model_id(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./:+-]{0,249}', value)) and '..' not in value and '://' not in value


def zero(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return False
    try:
        number = Decimal(str(value).strip())
        return number.is_finite() and number == 0
    except InvalidOperation:
        return False


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


def request(url: str, *, key: str | None = None, body: dict[str, Any] | None = None) -> Any:
    """Only fixed public sources or explicitly allowed management paths."""
    gateway_paths = {'/api/providers?limit=200', '/v1/models', '/api/combos?limit=200'}
    gateway_paths |= {'/api/provider-models?provider=' + p for p in PROVIDERS}
    if body is not None:
        require(url == GATEWAY + '/api/provider-models' and key is not None, 'write_destination_blocked')
        require(body.get('provider') in PROVIDERS and model_id(body.get('modelId')), 'write_payload_blocked')
    elif key is not None:
        require(url in {GATEWAY + p for p in gateway_paths}, 'credential_destination_blocked')
    else:
        require(url in SOURCES.values(), 'source_destination_blocked')
    headers = {'User-Agent': 'Firbo-Free-Catalogue/1', 'Accept': 'application/json, text/html', 'Cache-Control': 'no-cache'}
    if key is not None:
        require(key and not any(ord(c) < 32 for c in key), 'invalid_management_credential')
        headers['Authorization'] = 'Bearer ' + key
    payload = None if body is None else json.dumps(body).encode()
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    try:
        # Ignore environment proxy settings: no credential-bearing HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(urllib.request.Request(url, data=payload, headers=headers), timeout=20) as response:
            require(response.status in (200, 201), 'unexpected_http_status')
            raw = response.read(MAX_BYTES + 1)
            require(len(raw) <= MAX_BYTES, 'response_too_large')
            if url == SOURCES['opencode_docs']:
                require('text/html' in response.headers.get('Content-Type', ''), 'source_content_type_invalid')
                return raw.decode('utf-8')
            require('json' in response.headers.get('Content-Type', ''), 'source_content_type_invalid')
            return json.loads(raw)
    except urllib.error.HTTPError as exc:
        raise Blocked('http_' + str(exc.code)) from None
    except (OSError, UnicodeError, ValueError, urllib.error.URLError):
        raise Blocked('network_or_response_invalid') from None


class Tables(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self.table: list[list[str]] | None = None
        self.row: list[str] | None = None
        self.cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == 'table':
            self.table = []
        elif tag == 'tr' and self.table is not None:
            self.row = []
        elif tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_data(self, data: str) -> None:
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in ('td', 'th') and self.cell is not None and self.row is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None and self.table is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def rows(value: Any, key: str, limit: int = 20_000) -> list[dict[str, Any]]:
    data = value.get(key) if isinstance(value, dict) else None
    require(isinstance(data, list) and len(data) <= limit and all(isinstance(r, dict) for r in data), 'catalogue_contract_mismatch')
    return data


def unique_ids(data: list[dict[str, Any]]) -> set[str]:
    ids = [r.get('id') for r in data]
    require(all(model_id(v) for v in ids) and len(set(ids)) == len(ids), 'catalogue_ids_invalid')
    return set(ids)


def offer(provider: str, ident: str, name: str, basis: str) -> dict[str, Any]:
    # NVIDIA trial-only offers remain visible for review, never auto-registered.
    terms_review = provider == 'opencode' and ident.startswith('nemotron-')
    return {'provider': provider, 'model_id': ident, 'name': name[:160], 'price_evidence': basis,
            'inference_tested': False, 'public_data_only': True,
            'eligible_for_registration': not terms_review, 'terms_review_required': terms_review}


def opencode_offers(catalogue: Any, html: str) -> list[dict[str, Any]]:
    available = unique_ids(rows(catalogue, 'data'))
    require(available, 'opencode_empty_catalogue')
    parser = Tables()
    parser.feed(html)
    endpoints, free_names = {}, set()
    endpoint_tables = price_tables = 0
    for table in parser.tables:
        if not table:
            continue
        header = [c.casefold() for c in table[0]]
        if all(k in header for k in ('model', 'model id', 'endpoint')):
            endpoint_tables += 1
            for row in table[1:]:
                require(len(row) == len(header), 'opencode_table_shape_changed')
                name, ident, endpoint = (row[header.index(k)] for k in ('model', 'model id', 'endpoint'))
                require(name not in endpoints, 'opencode_ambiguous_model_name')
                endpoints[name] = (ident, endpoint)
        if all(k in header for k in ('model', 'input', 'output')):
            price_tables += 1
            for row in table[1:]:
                require(len(row) == len(header), 'opencode_table_shape_changed')
                # Both token directions explicitly free; no credits or "starting at".
                if all(row[header.index(k)].casefold() == 'free' for k in ('input', 'output')):
                    other = [v.casefold() for i, v in enumerate(row) if header[i] not in ('model', 'input', 'output')]
                    if all(v in ('free', '-', '—', 'n/a') or zero(v) for v in other):
                        free_names.add(row[header.index('model')])
    require(endpoint_tables == price_tables == 1, 'opencode_price_tables_missing_or_ambiguous')
    result = []
    for name in sorted(free_names):
        ident, endpoint = endpoints.get(name, ('', ''))
        if ident in available and model_id(ident) and endpoint == 'https://opencode.ai/zen/v1/chat/completions':
            # Trial-only endpoints are candidates, not silently approved for production.
            result.append(offer('opencode', ident, name, 'official_docs_free_and_live_catalogue'))
    require(len(result) <= MAX_ADDITIONS, 'opencode_offer_count_requires_review')
    return result


def openrouter_offers(catalogue: Any) -> list[dict[str, Any]]:
    data = rows(catalogue, 'data')
    require(data, 'openrouter_empty_catalogue')
    # Paid/non-candidate identifiers are never sent to the gateway. Their format
    # must not prevent discovery of unrelated, strictly validated free variants.
    candidates = [row for row in data if isinstance(row.get('id'), str)
                  and (row['id'].endswith(':free') or row['id'] == 'openrouter/free')
                  and (not row['id'].startswith('openrouter/') or row['id'] == 'openrouter/free')]
    unique_ids(candidates)  # Duplicate/unsafe candidate IDs still block the source.
    result = []
    for row in candidates:
        ident, pricing = row['id'], row.get('pricing')
        if not isinstance(pricing, dict) or not all(k in pricing for k in ('prompt', 'completion')):
            continue
        if not all(zero(v) for v in pricing.values()):
            continue  # Missing/unknown/negative/NaN is never "free".
        architecture = row.get('architecture')
        if not isinstance(architecture, dict) or architecture.get('output_modalities') != ['text']:
            continue
        if 'text' not in (architecture.get('input_modalities') or []):
            continue
        result.append(offer('openrouter', ident, str(row.get('name') or ident), 'official_catalogue_all_price_fields_zero'))
    require(len(result) <= MAX_ADDITIONS, 'openrouter_offer_count_requires_review')
    return sorted(result, key=lambda row: row['model_id'])


def discover(fetch: Callable[..., Any] = request) -> dict[str, Any]:
    result: dict[str, Any] = {'offers': [], 'source_errors': {}, 'source_urls': SOURCES,
                              'checked_at': dt.datetime.now(dt.timezone.utc).isoformat()}
    for provider in PROVIDERS:
        try:
            found = (opencode_offers(fetch(SOURCES['opencode_models']), fetch(SOURCES['opencode_docs']))
                     if provider == 'opencode' else openrouter_offers(fetch(SOURCES['openrouter_models'])))
            result['offers'].extend(found)
        except Blocked as exc:
            result['source_errors'][provider] = str(exc)
    return result


def runtime() -> tuple[str, str]:
    require(os.geteuid() == 0, 'run_in_existing_root_hostinger_console')
    binary = shutil.which('docker')
    require(binary, 'docker_missing')
    env = {k: v for k, v in os.environ.items() if not k.startswith('DOCKER_')}
    fmt = '{"name":{{json .Name}},"running":{{json .State.Running}},"image":{{json .Image}},"env":{{json .Config.Env}}}'
    try:
        response = subprocess.run([binary, '--host', 'unix:///var/run/docker.sock', 'container', 'inspect', '--format', fmt, 'firbo-api'],
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=15, check=False, env=env)
        require(response.returncode == 0 and len(response.stdout) <= 1024 * 1024, 'docker_inspect_failed')
        data = json.loads(response.stdout)
        require(data.get('name') == '/firbo-api' and data.get('running') is True, 'wrong_or_stopped_firbo_api')
        settings = dict(v.split('=', 1) for v in data.get('env', []) if isinstance(v, str) and '=' in v)
        require(settings.get('SUPABASE_URL', '').rstrip('/') == 'https://bfeinnsorgjycivozcau.supabase.co', 'wrong_firbo_project')
        key = settings.get('OMNIROUTE_MANAGEMENT_KEY', '')
        require(key and not any(ord(c) < 32 for c in key), 'management_key_missing_or_invalid')
        return key, fingerprint(data)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise Blocked('local_runtime_unavailable') from None


def gateway(key: str, path: str, body: dict[str, Any] | None = None) -> Any:
    return request(GATEWAY + path, key=key, body=body)


def active_providers(payload: Any) -> set[str]:
    connections = rows(payload, 'connections', 200)
    total = payload.get('total')
    require(total is None or (type(total) is int and total == len(connections)), 'provider_pagination_incomplete')
    return {r['provider'] for r in connections if r.get('provider') in PROVIDERS and r.get('isActive') is True}


def registration_plan(offers: list[dict[str, Any]], active: set[str], custom: dict[str, Any], catalogue: Any) -> list[dict[str, Any]]:
    registered = rows(catalogue, 'data')
    out = []
    for item in offers:
        provider, ident = item['provider'], item['model_id']
        if item.get('eligible_for_registration') is not True:
            continue
        if provider not in active:
            continue
        existing = rows(custom[provider], 'models')
        hidden = custom[provider].get('hiddenModelsByProvider', {})
        require(isinstance(hidden, dict), 'hidden_model_contract_invalid')
        hidden_ids = hidden.get(provider, [])
        require(isinstance(hidden_ids, list), 'hidden_model_contract_invalid')
        if ident in hidden_ids or any(r.get('id') == ident for r in existing):
            continue  # Never unhide, overwrite, rename or relabel operator entries.
        aliases = ALIASES[provider]
        matches = {p + '/' + ident for p in aliases}
        if any(r.get('id') in matches or (r.get('id') == ident and r.get('owned_by') in aliases) for r in registered):
            continue
        out.append(item)
    require(len(out) <= MAX_ADDITIONS, 'too_many_new_models')
    return out


class Journal:
    def __init__(self, root: Path = JOURNAL_ROOT) -> None:
        require(root.is_absolute() and root.resolve() == root, 'unsafe_journal_directory')
        if not root.exists():
            root.mkdir(mode=0o700)
        info = root.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0, 'unsafe_journal_permissions')
        fd, name = tempfile.mkstemp(prefix='catalogue-', suffix='.jsonl', dir=root)
        self.path = name
        self.stream = os.fdopen(fd, 'w')

    def write(self, value: Any) -> None:
        self.stream.write(json.dumps(value, sort_keys=True) + '\n')
        self.stream.flush()
        os.fsync(self.stream.fileno())

    def close(self) -> None:
        self.stream.close()


def register(plan: list[dict[str, Any]], call: Callable[..., Any], journal: Any,
             progress: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
    """No automatic retry, rollback deletion or mutation of an existing entry."""
    created: list[dict[str, str]] = [] if progress is None else progress
    for item in plan:
        require(item.get('eligible_for_registration') is True and not item.get('terms_review_required'), 'offer_requires_terms_review')
        provider, ident = item['provider'], item['model_id']
        if any(r.get('id') == ident for r in rows(call('/api/provider-models?provider=' + provider), 'models')):
            continue
        body = {'provider': provider, 'modelId': ident, 'modelName': item['name'], 'source': 'manual',
                'apiFormat': 'chat-completions', 'supportedEndpoints': ['chat'], 'modelType': 'chat', 'isFree': True}
        journal.write({'phase': 'requested', 'provider': provider, 'model_id': ident})
        try:
            call('/api/provider-models', body)
            actual = rows(call('/api/provider-models?provider=' + provider), 'models')
            found = [r for r in actual if r.get('id') == ident]
            require(len(found) == 1 and found[0].get('isFree') is True and found[0].get('apiFormat') == 'chat-completions', 'registration_not_verified')
        except Exception:
            journal.write({'phase': 'reconcile_required', 'provider': provider, 'model_id': ident})
            raise Blocked('registration_outcome_requires_review_do_not_retry_blindly') from None
        created.append({'provider': provider, 'model_id': ident})
        journal.write({'phase': 'verified', **created[-1]})
    return created


def run(public_only: bool = False, apply: bool = False) -> tuple[dict[str, Any], int]:
    report: dict[str, Any] = {'contract': 'firbo-free-catalogue/v1', 'status': 'blocked', 'inference_requests': 0,
                              'runtime_deployment_performed': False, 'agent_settings_write_requested': False,
                              'writes_may_have_occurred': False,
                              'report_contains_secrets': False, 'limitations': LIMITATIONS}
    journal = None
    try:
        report.update(discover())
        require(report['offers'], 'no_verified_free_offers')
        if public_only:
            report['status'] = 'public_catalogue_checked'
            return report, 0 if not report['source_errors'] else 2
        key, before_runtime = runtime()
        call = lambda path, body=None: gateway(key, path, body)
        active = active_providers(call('/api/providers?limit=200'))
        report['connected_supported_providers'] = sorted(active)
        report['requires_provider_connection'] = sorted(set(PROVIDERS) - active)
        require(not (active & set(report['source_errors'])), 'connected_provider_price_source_unavailable')
        custom = {p: call('/api/provider-models?provider=' + p) for p in active}
        catalogue = call('/v1/models')
        plan = registration_plan(report['offers'], active, custom, catalogue)
        report['proposed_additions'] = plan
        if not apply or not plan:
            report['status'] = 'plan_ready' if plan else 'no_new_models_for_connected_providers'
            return report, 0
        combos = call('/api/combos?limit=200')
        combo_rows = rows(combos, 'combos', 200)
        require(combos.get('total', len(combo_rows)) == len(combo_rows), 'combo_pagination_incomplete')
        journal = Journal()
        report['journal_path'] = journal.path
        journal.write({'phase': 'before', 'checked_at': report['checked_at'], 'plan': plan,
                       'catalogue_digest': fingerprint(custom), 'combos_digest': fingerprint(combo_rows)})
        report['registered_models'] = []
        report['writes_may_have_occurred'] = True
        register(plan, call, journal, report['registered_models'])
        for provider in active:
            after = rows(call('/api/provider-models?provider=' + provider), 'models')
            for old in rows(custom[provider], 'models'):
                require(any(old == new for new in after), 'existing_model_changed_review_required')
        report['existing_combos_unchanged'] = fingerprint(combo_rows) == fingerprint(rows(call('/api/combos?limit=200'), 'combos', 200))
        require(report['existing_combos_unchanged'], 'gateway_catalogue_hooks_changed_combos_review_required')
        report['runtime_unchanged'] = before_runtime == runtime()[1]
        require(report['runtime_unchanged'], 'runtime_changed_review_required')
        report['status'] = 'catalogue_registered_execution_unverified'
        journal.write({'phase': 'complete', 'registered_models': report['registered_models']})
        return report, 0
    except Blocked as exc:
        report['error'] = str(exc)
    except Exception:
        report['error'] = 'operation_failed_review_journal_if_present'
    finally:
        if journal is not None:
            try:
                journal.close()
            except OSError:
                pass
    return report, 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--public-only', action='store_true')
    modes.add_argument('--apply', action='store_true', help='Append verified offers for already connected providers; no agent switch')
    args = parser.parse_args()
    data, code = run(args.public_only, args.apply)
    print(json.dumps(data, indent=2, ensure_ascii=False))
    raise SystemExit(code)
