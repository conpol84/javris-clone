"""Source-only OpenJarvis inventory; never equate registered code with live access.

Run from the repository: python scripts/firbo_parity_inventory.py
  --upstream <reviewed commit> --output docs/FIRBO-OPENJARVIS-INVENTORY.json
No imports from the engine, credentials, networking or runtime actions occur.
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def inventory(upstream: str) -> dict:
    upstream = git("rev-parse", "--verify", upstream + "^{commit}")
    scopes = {}
    for scope in ("src/openjarvis", "frontend/src", "rust", "tests"):

        def tree(ref: str) -> dict[str, str]:
            rows = git("ls-tree", "-r", ref, "--", scope).splitlines()
            return {r.split("\t", 1)[1]: r.split()[2] for r in rows}

        original, ours = tree(upstream), tree("HEAD")
        scopes[scope] = {
            "upstream_files": len(original),
            "firbo_files": len(ours),
            "missing": sorted(original.keys() - ours.keys()),
            "added": sorted(ours.keys() - original.keys()),
            "modified": sorted(
                p for p in original.keys() & ours.keys() if original[p] != ours[p]
            ),
        }
    registrations = []
    registries = {
        "ToolRegistry",
        "ChannelRegistry",
        "ConnectorRegistry",
        "AgentRegistry",
        "EngineRegistry",
    }
    for path in sorted((ROOT / "src/openjarvis").rglob("*.py")):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(
                node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
            ):
                continue
            for dec in node.decorator_list:
                if not (
                    isinstance(dec, ast.Call)
                    and isinstance(dec.func, ast.Attribute)
                    and isinstance(dec.func.value, ast.Name)
                    and dec.func.attr == "register"
                    and dec.func.value.id in registries
                    and dec.args
                    and isinstance(dec.args[0], ast.Constant)
                    and isinstance(dec.args[0].value, str)
                ):
                    continue
                registrations.append(
                    {
                        "registry": dec.func.value.id,
                        "name": dec.args[0].value,
                        "source": str(path.relative_to(ROOT)),
                        "line": node.lineno,
                        "evidence": "SOURCE",
                        "runtime_verified": False,
                    }
                )
    return {
        "upstream_commit": upstream,
        "firbo_source_trees": {
            scope: git("rev-parse", "HEAD:" + scope) for scope in scopes
        },
        "meaning": (
            "Presence and registrations only. No installation, enabled-tool, "
            "account or execution claim."
        ),
        "scopes": scopes,
        "counts": {
            name: sum(r["registry"] == name for r in registrations)
            for name in sorted(registries)
        },
        "registrations": registrations,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    data = inventory(args.upstream)
    args.output.write_text(json.dumps(data, indent=2) + "\n")
    print(
        json.dumps(
            {
                "counts": data["counts"],
                "missing": {k: len(v["missing"]) for k, v in data["scopes"].items()},
            }
        )
    )


if __name__ == "__main__":
    main()
