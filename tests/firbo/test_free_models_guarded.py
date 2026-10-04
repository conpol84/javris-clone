"""Unit tests: mocked helpers/transport only. No Docker, credentials or model calls."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('free_models_guarded', ROOT / 'deploy/hostinger/free_models_guarded.py')
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)


class Blocked(Exception): pass


def require(ok, code):
    if not ok: raise Blocked(code)


class Helper:
    Blocked = Blocked
    LIMITATIONS = ['Catalogue is not inference verification']
    PROVIDERS = ('opencode', 'openrouter')
    MAX_BYTES = 1024
    require = staticmethod(require)
    fingerprint = staticmethod(lambda value: hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest())

    def __init__(self, root):
        self.JOURNAL_ROOT = root / 'journal'
        self.models = {'opencode': [], 'openrouter': []}
        self.hidden = {}
        self.combos = [{'name': 'firbo-economy', 'models': ['oc/old']}]
        self.active = ['opencode']
        self.offers = [{'provider': 'opencode', 'model_id': 'example-free', 'name': 'Example',
                        'eligible_for_registration': True, 'terms_review_required': False}]
        self.errors = {}
        self.requests = []
        self.posts = []
        self.events = []
        self.token = 'must-not-appear'

    @staticmethod
    def rows(value, key, limit=20000):
        data = value.get(key) if isinstance(value, dict) else None
        require(isinstance(data, list) and len(data) <= limit, 'catalogue_contract_mismatch')
        return data

    def discover(self):
        return {'offers': copy.deepcopy(self.offers), 'source_errors': self.errors, 'checked_at': 'test-snapshot'}

    def runtime(self): return self.token, 'runtime-fingerprint'

    def active_providers(self, value): return {x['provider'] for x in value['connections']}

    def gateway(self, key, path, body=None):
        assert key == self.token
        self.requests.append((path, body))
        if body is not None:
            assert path == '/api/provider-models'
            self.posts.append(copy.deepcopy(body))
            self.models[body['provider']].append({'id': body['modelId'], 'isFree': True, 'apiFormat': 'chat-completions'})
            return {}
        if path == '/api/providers?limit=200':
            return {'connections': [{'provider': p} for p in self.active]}
        if path == '/api/combos?limit=200':
            return {'combos': copy.deepcopy(self.combos), 'total': len(self.combos)}
        if path == '/v1/models': return {'data': []}
        if path.startswith('/api/provider-models?provider='):
            p = path.split('=')[-1]
            return {'models': copy.deepcopy(self.models[p]), 'hiddenModelsByProvider': copy.deepcopy(self.hidden)}
        raise AssertionError('Unexpected endpoint ' + path)

    def registration_plan(self, offers, active, custom, catalogue):
        return [x for x in offers if x['provider'] in active and x.get('eligible_for_registration')
                and x['model_id'] not in custom[x['provider']].get('hiddenModelsByProvider', {}).get(x['provider'], [])
                and x['model_id'] not in [m['id'] for m in custom[x['provider']]['models']]]

    def Journal(self):
        return types.SimpleNamespace(path='safe-local-journal', write=self.events.append, close=lambda: None)

    def register(self, plan, call, journal, progress):
        for item in plan:
            provider, ident = item['provider'], item['model_id']
            current = call('/api/provider-models?provider=' + provider)
            if any(m['id'] == ident for m in current['models']): continue
            journal.write({'phase': 'requested'})
            call('/api/provider-models', {'provider': provider, 'modelId': ident, 'isFree': True})
            current = call('/api/provider-models?provider=' + provider)
            require(any(m['id'] == ident for m in current['models']), 'readback_failed')
            progress.append({'provider': provider, 'model_id': ident})


class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.f = Helper(self.root)
        self.empty = lambda *_: {'pools': [], 'total': 0}

    def run_guard(self, apply=True, reader=None):
        return g.run(self.f, apply, reader or self.empty)

    def test_default_plan_does_not_mutate(self):
        report, code = self.run_guard(False)
        self.assertEqual((code, report['status']), (0, 'guarded_plan_ready'))
        self.assertFalse(self.f.posts)
        self.assertFalse(self.f.JOURNAL_ROOT.exists())

    def test_append_readback_preserves_existing_routing(self):
        old = copy.deepcopy(self.f.combos)
        report, code = self.run_guard()
        self.assertEqual((code, report['status']), (0, 'catalogue_registered_execution_unverified'))
        self.assertEqual(len(report['registered_models']), 1)
        self.assertEqual(self.f.combos, old)
        self.assertEqual(report['inference_requests'], 0)
        self.assertNotIn(self.f.token, json.dumps(report))

    def test_existing_pool_blocks_before_write(self):
        report, code = self.run_guard(reader=lambda *_: {'pools': [{'id': 'private-id'}], 'total': 1})
        self.assertEqual(code, 1)
        self.assertIn('quota_pools_present', report['error'])
        self.assertFalse(self.f.posts)
        self.assertNotIn('private-id', json.dumps(report))

    def test_no_assumed_empty_pools_when_total_missing(self):
        report, code = self.run_guard(reader=lambda *_: {'pools': []})
        self.assertEqual(code, 1)
        self.assertEqual(report['error'], 'quota_pool_pagination_incomplete')
        self.assertFalse(self.f.posts)

    def test_truncated_pools_block(self):
        report, code = self.run_guard(reader=lambda *_: {'pools': [], 'total': 201})
        self.assertEqual(code, 1)
        self.assertFalse(self.f.posts)

    def test_invalid_pool_contract_blocks(self):
        for value in [None, {}, {'pools': 'not-list'}, {'pools': [], 'total': True}]:
            with self.subTest(value=value):
                self.assertEqual(self.run_guard(reader=lambda *_, v=value: v)[1], 1)
                self.assertFalse(self.f.posts)

    def test_pool_appears_just_before_post(self):
        counter = [0]
        def reader(*_):
            counter[0] += 1
            return {'pools': [], 'total': 0} if counter[0] < 3 else {'pools': [{}], 'total': 1}
        report, code = self.run_guard(reader=reader)
        self.assertEqual(code, 1)
        self.assertFalse(self.f.posts)
        self.assertFalse(report['writes_may_have_occurred'])

    def test_pool_after_post_blocks_remaining_additions(self):
        self.f.offers.append({**self.f.offers[0], 'model_id': 'another-free'})
        report, code = self.run_guard(reader=lambda *_: {'pools': [{}], 'total': 1} if self.f.posts else self.empty())
        self.assertEqual(code, 1)
        self.assertEqual(len(self.f.posts), 1)
        self.assertTrue(report['writes_may_have_occurred'])
        self.assertEqual(len(report['registered_models']), 1)

    def test_hidden_choices_are_preserved(self):
        self.f.hidden = {'opencode': ['example-free']}
        report, code = self.run_guard()
        self.assertEqual(code, 0)
        self.assertEqual(report['status'], 'no_new_models_for_connected_providers')
        self.assertFalse(self.f.posts)

    def test_trial_offer_is_not_registered(self):
        self.f.offers[0]['eligible_for_registration'] = False
        self.assertEqual(self.run_guard()[1], 0)
        self.assertFalse(self.f.posts)

    def test_never_creates_missing_provider(self):
        self.f.active = []
        report, code = self.run_guard()
        self.assertEqual(code, 0)
        self.assertEqual(report['requires_provider_connection'], ['opencode', 'openrouter'])
        self.assertFalse(self.f.posts)

    def test_price_source_failure_for_connected_provider_blocks(self):
        self.f.errors = {'opencode': 'unavailable'}
        report, code = self.run_guard()
        self.assertEqual(code, 1)
        self.assertFalse(self.f.posts)

    def test_other_provider_source_failure_does_not_invent_offers(self):
        self.f.errors = {'openrouter': 'unavailable'}
        report, code = self.run_guard()
        self.assertEqual(code, 0)
        self.assertTrue(all(m['provider'] == 'opencode' for m in report['registered_models']))

    def test_stale_price_snapshot_prevents_post(self):
        with patch.object(g, 'PRICE_MAX_AGE_SECONDS', -1):
            report, code = self.run_guard()
        self.assertEqual(code, 1)
        self.assertEqual(report['error'], 'price_snapshot_expired_rerun_plan')
        self.assertFalse(self.f.posts)

    def test_runtime_change_prevents_post(self):
        with patch.object(self.f, 'runtime', side_effect=[(self.f.token, 'before'), (self.f.token, 'after')]):
            report, code = self.run_guard()
        self.assertEqual(code, 1)
        self.assertFalse(self.f.posts)

    def test_raw_failure_is_not_exposed(self):
        report, code = self.run_guard(reader=lambda *_: (_ for _ in ()).throw(RuntimeError(self.f.token)))
        self.assertEqual(code, 1)
        self.assertNotIn(self.f.token, json.dumps(report))
        self.assertFalse(self.f.posts)

    def test_existing_models_never_replaced(self):
        self.f.models['opencode'] = [{'id': 'preserve', 'isFree': False}]
        report, code = self.run_guard()
        self.assertEqual(code, 0)
        self.assertIn({'id': 'preserve', 'isFree': False}, self.f.models['opencode'])

    def test_model_changes_are_detected(self):
        with self.assertRaisesRegex(Blocked, 'existing_model_changed'):
            g.verify_preserved(self.f, {'opencode': {'models': [{'id': 'x'}]}}, {'opencode': {'models': []}})

    def test_hidden_changes_are_detected(self):
        with self.assertRaisesRegex(Blocked, 'hidden_models_changed'):
            g.verify_preserved(self.f, {'opencode': {'models': []}}, {'opencode': {'models': [], 'hiddenModelsByProvider': {'opencode': ['x']}}})

    def test_lock_blocks_second_registration(self):
        with g.registration_lock(self.f):
            report, code = self.run_guard()
        self.assertEqual(code, 1)
        self.assertEqual(report['error'], 'another_catalogue_registration_running')
        self.assertFalse(self.f.posts)

    def test_unsafe_journal_permissions_not_repaired(self):
        self.f.JOURNAL_ROOT.mkdir(mode=0o755)
        os.chmod(self.f.JOURNAL_ROOT, 0o755)
        report, code = self.run_guard()
        self.assertEqual(code, 1)
        self.assertEqual(os.stat(self.f.JOURNAL_ROOT).st_mode & 0o777, 0o755)
        self.assertFalse(self.f.posts)

    def test_helper_checksum_rejects_before_execution(self):
        (self.root / 'free_models.py').write_text('raise RuntimeError("untrusted")')
        with patch.object(g, '__file__', str(self.root / 'free_models_guarded.py')):
            with self.assertRaisesRegex(ValueError, 'helper_checksum_mismatch'):
                g.load_helper()

    def test_helper_exact_bytes_loaded(self):
        data = b'VALUE = 17\n'
        (self.root / 'free_models.py').write_bytes(data)
        with patch.object(g, '__file__', str(self.root / 'free_models_guarded.py')), patch.object(g, 'HELPER_SHA256', hashlib.sha256(data).hexdigest()):
            self.assertEqual(g.load_helper().VALUE, 17)

    def test_management_get_fixed_destination_no_redirect_proxy(self):
        self.f.NoRedirect = urllib_no_redirect
        response = types.SimpleNamespace(status=200, headers={'Content-Type': 'application/json'}, read=lambda _: b'{"pools":[],"total":0}')
        from unittest.mock import MagicMock
        opener = MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with patch.object(g.urllib.request, 'build_opener', return_value=opener) as build:
            self.assertEqual(g.read_pools(self.f, self.f.token), {'pools': [], 'total': 0})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, g.POOL_URL)
        self.assertEqual(request.get_method(), 'GET')
        self.assertEqual(build.call_args.args[0].proxies, {})


class urllib_no_redirect(g.urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_, **__): return None


if __name__ == '__main__': unittest.main()
