"""Read-only inventory of the current agent, never the static tool registry."""

from typing import Any


def agent_runtime_inventory(agent: Any) -> dict[str, Any]:
    """Report loaded tools, without running discovery or granting permission.

    ToolExecutor owns the dispatch map. Some third-party agents do not expose
    it; their tool inventory stays unknown instead of becoming a verified zero.
    """
    loaded = agent is not None and callable(getattr(agent, "run", None))
    executor = getattr(agent, "_executor", None) if loaded else None
    tools = getattr(executor, "_tools", None)
    known = isinstance(tools, dict) and all(
        isinstance(name, str) and 0 < len(name) <= 120 for name in tools
    )
    names = sorted(tools) if known else []
    return {
        "contract": "openjarvis-runtime/v1",
        "agent_loaded": loaded,
        "tool_inventory_known": known,
        "tool_count": len(names) if known else None,
        "tool_names": names[:128],
        "truncated": len(names) > 128,
    }
