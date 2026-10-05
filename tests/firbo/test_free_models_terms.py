"""Offline regression tests; all upstreams and Docker are mocked."""

import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "free_models", ROOT / "deploy/hostinger/free_models.py"
)
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


def or_model(ident="vendor/example:free"):
    return {
        "id": ident,
        "name": "Example",
        "pricing": {"prompt": "0", "completion": "0", "request": "0"},
        "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
    }


class BoundaryTests(unittest.TestCase):
    def test_openrouter_unrelated_unsupported_paid_ids_do_not_block_free_candidates(
        self,
    ):
        out = f.openrouter_offers(
            {
                "data": [
                    or_model(),
                    or_model("vendor/paid@format"),
                    {"id": None},
                    or_model("vendor/paid@format"),
                ]
            }
        )
        self.assertEqual([r["model_id"] for r in out], ["vendor/example:free"])

    def test_openrouter_unsafe_free_ids_still_block(self):
        with self.assertRaises(f.Blocked):
            f.openrouter_offers({"data": [or_model("bad\nheader:free")]})

    def test_openrouter_duplicate_free_ids_still_block(self):
        with self.assertRaises(f.Blocked):
            f.openrouter_offers({"data": [or_model(), or_model()]})

    def test_trial_only_offers_visible_but_not_registered(self):
        item = f.offer("opencode", "nemotron-3-ultra-free", "Trial", "docs")
        self.assertTrue(item["terms_review_required"])
        self.assertFalse(item["eligible_for_registration"])
        self.assertEqual(
            f.registration_plan(
                [item], {"opencode"}, {"opencode": {"models": []}}, {"data": []}
            ),
            [],
        )

    def test_trial_only_cannot_bypass_plan_and_write(self):
        item = f.offer("opencode", "nemotron-3-ultra-free", "Trial", "docs")
        with self.assertRaises(f.Blocked):
            f.register([item], lambda *_: self.fail("must not call gateway"), None)


if __name__ == "__main__":
    unittest.main()
