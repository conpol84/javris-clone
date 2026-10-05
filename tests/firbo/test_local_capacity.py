"""Resource report tests. Do not run Docker commands or inference from these tests."""

import importlib.util
import json
import shutil
from pathlib import Path

R = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "capacity", R / "deploy/hostinger/local_model_capacity.py"
)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def test_memory_only_reports_reviewed_keys():
    assert p.memory(
        "MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\nSecretKey: 123 kB\n"
    ) == {"MemTotal": 8, "MemAvailable": 4}


def test_report_does_not_dump_environment_or_unknown_containers(monkeypatch, capsys):
    monkeypatch.setattr(
        p,
        "text",
        lambda name: (
            "MemTotal: 8388608 kB\nMemAvailable: 4194304 kB\n"
            if name == "/proc/meminfo"
            else ""
        ),
    )
    monkeypatch.setattr(
        p.shutil, "which", lambda name: "/usr/bin/docker" if name == "docker" else None
    )
    calls = []

    def run(args):
        calls.append(args)
        if args[1] == "ps":
            return "firbo-api\nother-customer-secret\n"
        return json.dumps(
            {
                "Name": "firbo-api",
                "CPUPerc": "2%",
                "MemUsage": "1GiB / 8GiB",
                "MemPerc": "12%",
                "PIDs": "5",
                "SECRET": "must-not-leak",
            }
        )

    monkeypatch.setattr(p, "command", run)
    assert p.main() == 0
    value = json.loads(capsys.readouterr().out)
    assert value["read_only"] is True and value["model_execution_performed"] is False
    assert len(value["container_stats"]) == 1
    assert "must-not-leak" not in json.dumps(value)
    assert all("inspect" not in args and "exec" not in args for args in calls)
    assert "other-customer-secret" not in calls[-1]


def test_compose_candidate_has_no_public_port_or_automatic_pull():
    text = (R / "deploy/hostinger/compose.ollama-candidate.yaml").read_text()
    assert "\n    ports:" not in text and "profiles: [local-models]" in text
    assert 'OLLAMA_NO_CLOUD: "1"' in text and "internal: true" in text
    assert 'user: "10001:10001"' in text
