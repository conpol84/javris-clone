"""The actual loaded dispatch map, without registry discovery or execution."""

import asyncio
from types import SimpleNamespace

from openjarvis.server.routes import server_info
from openjarvis.server.runtime_inventory import agent_runtime_inventory


def agent(tools):
    return SimpleNamespace(run=lambda: None, _executor=SimpleNamespace(_tools=tools))


def test_configured_name_does_not_prove_agent_loaded():
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                agent=None,
                agent_name="orchestrator",
                model="model",
                engine_name="engine",
            )
        )
    )
    result = asyncio.run(server_info(request))
    assert result["agent"] == "orchestrator"
    assert result["runtime"]["agent_loaded"] is False
    assert result["runtime"]["tool_count"] is None


def test_loaded_dispatch_names_without_exporting_tools_or_secrets():
    result = agent_runtime_inventory(
        agent({"file_write": {"secret": "hidden"}, "shell_exec": object()})
    )
    assert result["tool_names"] == ["file_write", "shell_exec"]
    assert result["tool_count"] == 2
    assert "hidden" not in str(result)


def test_unknown_inventory_is_distinct_from_verified_empty():
    result = agent_runtime_inventory(SimpleNamespace(run=lambda: None))
    assert result["agent_loaded"] is True
    assert result["tool_inventory_known"] is False
    assert result["tool_count"] is None
    assert agent_runtime_inventory(agent({}))["tool_count"] == 0


def test_inventory_bound_preserves_total_and_marks_truncation():
    result = agent_runtime_inventory(
        agent({f"tool_{i:03}": object() for i in range(200)})
    )
    assert result["tool_count"] == 200
    assert len(result["tool_names"]) == 128
    assert result["truncated"] is True


def test_invalid_dispatch_names_are_not_coerced_or_exposed():
    for tools in [{1: object()}, {"x" * 121: object()}, []]:
        assert agent_runtime_inventory(agent(tools))["tool_inventory_known"] is False
