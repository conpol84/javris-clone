"""Exact native approvals: real files, executor/handler, races; no provider."""

import importlib.util
import json
import os
import stat
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest

from openjarvis.agents._stubs import AgentResult
from openjarvis.core.types import ToolCall, ToolResult
from openjarvis.server import native_approval as approval
from openjarvis.server.models import ChatCompletionRequest
from openjarvis.server.routes import _handle_agent
from openjarvis.tools._stubs import BaseTool, ToolExecutor, ToolSpec

GRANT_ID = "a" * 64
pytestmark = pytest.mark.skipif(os.name != "posix", reason="Linux native approval path")
ARGS = {"command": "printf approved", "timeout": 15, "working_dir": "/tmp"}


def request(grant=GRANT_ID):
    return ChatCompletionRequest(
        model="test",
        messages=[{"role": "user", "content": "exact task"}],
        firbo_include_execution=True,
        firbo_native_approval=grant,
    )


@pytest.fixture
def store(tmp_path, monkeypatch):
    root = tmp_path / "approvals"
    root.mkdir(mode=0o755)
    (root / "grants").mkdir(mode=0o711)
    (root / "used").mkdir(mode=0o700)
    monkeypatch.setattr(approval, "ROOT", root)
    # Model root/service ownership on unprivileged CI runners. Actual file
    # permissions, no-follow opens and exclusive reservation are not mocked.
    real_fstat = os.fstat
    used_inode = (root / "used").stat().st_ino

    def fstat(fd):
        value = real_fstat(fd)
        return SimpleNamespace(
            st_uid=1001 if value.st_ino == used_inode else 0,
            st_mode=value.st_mode,
            st_nlink=value.st_nlink,
            st_size=value.st_size,
        )

    proxy = SimpleNamespace(
        **{k: getattr(os, k) for k in dir(os) if not k.startswith("__")}
    )
    proxy.fstat = fstat
    proxy.geteuid = lambda: 1001
    monkeypatch.setattr(approval, "os", proxy)

    def issue(**changes):
        req = request()
        value = {
            "schema": "firbo-native-approval/v1",
            "id": GRANT_ID,
            "uid": 1001,
            "request_sha256": approval.request_digest(
                req.model, [m.model_dump() for m in req.messages]
            ),
            "tool": "shell_exec",
            "arguments": ARGS,
            "created_at": int(time.time()),
            "expires_at": int(time.time()) + 300,
        }
        value.update(changes)
        path = root / "grants" / (GRANT_ID + ".key")
        path.write_text(json.dumps(value))
        path.chmod(0o644)
        return path

    return root, issue


def load():
    req = request()
    return approval.reserve(GRANT_ID, req.model, [m.model_dump() for m in req.messages])


def prompt(args=ARGS):
    return approval.PREFIX + repr(args) + "?"


def test_exact_action_once_and_reservation_replay(store):
    _, issue = store
    issue()
    callback = load()
    assert callback(prompt(dict(reversed(list(ARGS.items())))))
    assert not callback(prompt())
    with pytest.raises(approval.ApprovalDenied):
        load()


@pytest.mark.parametrize(
    "args",
    [
        dict(ARGS, command="rm nope"),
        dict(ARGS, timeout=True),
        dict(ARGS, extra="x"),
        {"command": "printf approved"},
    ],
)
def test_mismatch_consumes_opportunity(store, args):
    store[1]()
    callback = load()
    assert not callback(prompt(args))
    assert not callback(prompt())


@pytest.mark.parametrize(
    "changes",
    [
        {"tool": "file_write"},
        {"uid": 99},
        {"request_sha256": "0" * 64},
        {"expires_at": 0},
        {"created_at": int(time.time()) + 60},
        {"expires_at": int(time.time()) + 600},
        {"unexpected": True},
        {"uid": True},
    ],
)
def test_invalid_scope_expiry_or_schema(store, changes):
    store[1](**changes)
    with pytest.raises(approval.ApprovalDenied):
        load()


def test_expiry_rechecked_at_execution(store, monkeypatch):
    store[1]()
    callback = load()
    monkeypatch.setattr(approval.time, "time", lambda: 99999999999)
    assert not callback(prompt())


@pytest.mark.parametrize(
    "kind", ["symlink", "hardlink", "writable", "oversize", "fifo", "directory"]
)
def test_untrusted_files(store, kind):
    root, issue = store
    path = issue()
    if kind == "hardlink":
        os.link(path, root / "alias")
    elif kind == "writable":
        path.chmod(0o666)
    elif kind == "oversize":
        path.write_text("x" * 32769)
    else:
        path.unlink()
        if kind == "symlink":
            path.symlink_to(root / "missing")
        elif kind == "fifo":
            os.mkfifo(path)
        else:
            path.mkdir()
    with pytest.raises(approval.ApprovalDenied):
        load()


def test_used_directory_symlink_denied(store):
    root, issue = store
    issue()
    (root / "used").rmdir()
    (root / "used").symlink_to(root / "grants", target_is_directory=True)
    with pytest.raises(approval.ApprovalDenied):
        load()


def test_reservation_race_and_callback_race(store):
    store[1]()

    def reserve():
        try:
            return load()
        except approval.ApprovalDenied:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        callbacks = list(pool.map(lambda _: reserve(), range(8)))
    winners = [c for c in callbacks if c]
    assert len(winners) == 1
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(lambda _: winners[0](prompt()), range(8))) == 1


class SensitiveTool(BaseTool):
    tool_id = "shell_exec"

    @property
    def spec(self):
        return ToolSpec(
            name="shell_exec",
            description="test",
            parameters={},
            requires_confirmation=True,
        )

    def execute(self, **params):
        return ToolResult("shell_exec", "executed", success=True)


def agent():
    executor = ToolExecutor([SensitiveTool()])
    value = SimpleNamespace(_model="original", _executor=executor)

    def run(*args, **kwargs):
        result = executor.execute(
            ToolCall(id="test", name="shell_exec", arguments=json.dumps(ARGS))
        )
        return AgentResult(content="done", tool_results=[result])

    value.run = run
    return value


def test_actual_handler_executor_approved_then_normal_request_denied(store):
    store[1]()
    value = agent()
    result = _handle_agent(value, "test", request())
    assert result.execution["failed_count"] == 0
    assert (
        not value._executor._interactive and value._executor._confirm_callback is None
    )
    assert value._model == "original"
    ordinary = _handle_agent(value, "test", request(None))
    assert ordinary.execution["failed_count"] == 1


def test_restore_on_exception_and_no_reuse(store):
    store[1]()
    value = agent()
    value.run = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("synthetic"))
    with pytest.raises(RuntimeError):
        _handle_agent(value, "test", request())
    assert (
        value._executor._confirm_callback is None and not value._executor._interactive
    )
    assert value._model == "original"
    with pytest.raises(approval.ApprovalDenied):
        _handle_agent(value, "test", request())


def test_preexisting_confirmation_policy_never_overridden(store):
    store[1]()
    value = agent()

    def callback(_):
        return False

    value._executor._confirm_callback = callback
    with pytest.raises(approval.ApprovalDenied):
        _handle_agent(value, "test", request())
    assert value._executor._confirm_callback is callback


def test_overlapping_requests_do_not_borrow_approval(store):
    store[1]()
    value = agent()
    original = value.run
    started = threading.Event()
    release = threading.Event()

    def run(*a, **kw):
        started.set()
        assert release.wait(5)
        return original(*a, **kw)

    value.run = run
    with ThreadPoolExecutor(max_workers=2) as pool:
        approved = pool.submit(_handle_agent, value, "test", request())
        assert started.wait(5)
        normal = pool.submit(_handle_agent, value, "test", request(None))
        release.set()
        assert approved.result().execution["failed_count"] == 0
        assert normal.result().execution["failed_count"] == 1


def test_bad_grant_id_cannot_be_path_or_boolean():
    for value in ("../x", True, "a" * 63):
        with pytest.raises(ValueError):
            request(value)


def test_grant_is_sensitive_to_file_tools(store):
    from openjarvis.security.file_policy import is_sensitive_file

    path = store[1]()
    assert is_sensitive_file(path)
    alias = path.parent.parent / "alias"
    alias.symlink_to(path)
    assert is_sensitive_file(alias)


def test_controller_bundle_matches_reviewed_runtime():
    base = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "approval_control_test", base / "deploy/hostinger/native-approval-control.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert set(module.BUNDLE) == {
        "server/routes.py",
        "server/models.py",
        "server/native_approval.py",
    }
    for name, expected in module.BUNDLE.items():
        assert module.digest((base / "src/openjarvis" / name).read_bytes()) == expected


@pytest.fixture
def controller(tmp_path, monkeypatch):
    base = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location(
        "approval_rollout_test", base / "deploy/hostinger/native-approval-control.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    package, staged, backups = (tmp_path / n for n in ("package", "stage", "backups"))
    for folder in (package, staged, backups):
        folder.mkdir()
    (staged / "repair-openjarvis-tools.py").write_bytes(
        (base / "deploy/hostinger/repair-openjarvis-tools.py").read_bytes()
    )
    monkeypatch.setattr(module, "PACKAGE", package)
    monkeypatch.setattr(module, "BACKUPS", backups)
    monkeypatch.setattr(module, "__file__", str(staged / "control.py"))
    monkeypatch.setattr(
        module,
        "operator",
        lambda: SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid()),
    )
    monkeypatch.setattr(module, "approval_directories", lambda _: None)
    monkeypatch.setattr(module, "check_service_policy", lambda: None)
    # Root ownership changes are irrelevant to synthetic temporary package files.
    proxy = SimpleNamespace(
        **{k: getattr(os, k) for k in dir(os) if not k.startswith("__")}
    )
    proxy.fchown = lambda *args: None
    real_lstat = Path.lstat

    # Backup-owner check remains exercised as root in production; emulate its
    # one required UID on non-root CI, preserving actual directory modes.
    def lstat(path):
        value = real_lstat(path)
        if path.parent == backups:
            return SimpleNamespace(st_uid=0, st_mode=value.st_mode)
        return value

    monkeypatch.setattr(Path, "lstat", lstat)
    monkeypatch.setattr(module, "os", proxy)
    baseline = {}
    for name in module.BASELINES:
        path = package / name
        path.parent.mkdir(exist_ok=True)
        raw = ("# original " + name + "\n").encode()
        path.write_bytes(raw)
        baseline[name] = module.digest(raw)
    monkeypatch.setattr(module, "BASELINES", baseline)
    bundle = {}
    for name in module.BUNDLE:
        raw = ("# candidate " + name + "\n").encode()
        (staged / Path(name).name).write_bytes(raw)
        bundle[name] = module.digest(raw)
    monkeypatch.setattr(module, "BUNDLE", bundle)
    return module, package, staged, backups


def test_rollout_exact_readback_idempotence_and_rollback(controller, monkeypatch):
    module, package, _, backups = controller
    restarts = []
    monkeypatch.setattr(module, "restart_and_verify", lambda: restarts.append(True))
    module.install()
    assert len(restarts) == 1
    for name, expected in module.BUNDLE.items():
        assert module.digest((package / name).read_bytes()) == expected
    module.install()
    assert len(restarts) == 1
    module.rollback(next(backups.iterdir()))
    assert len(restarts) == 2
    assert not (package / "server/native_approval.py").exists()
    for name, expected in module.BASELINES.items():
        assert module.digest((package / name).read_bytes()) == expected


def test_rollout_readiness_failure_restores_originals(controller, monkeypatch):
    module, package, _, _ = controller
    restarts = []

    def restart():
        restarts.append(True)
        if len(restarts) == 1:
            raise ValueError("synthetic_readiness_failure")

    monkeypatch.setattr(module, "restart_and_verify", restart)
    with pytest.raises(ValueError, match="install_failed_rolled_back"):
        module.install()
    assert len(restarts) == 2
    assert not (package / "server/native_approval.py").exists()
    for name, expected in module.BASELINES.items():
        assert module.digest((package / name).read_bytes()) == expected


def test_rollout_unknown_code_is_preserved(controller, monkeypatch):
    module, package, _, backups = controller
    path = package / "server/routes.py"
    path.write_text("# newer unrelated work\n")
    monkeypatch.setattr(
        module, "restart_and_verify", lambda: pytest.fail("unexpected restart")
    )
    with pytest.raises(ValueError, match="unknown_installed_code"):
        module.install()
    assert path.read_text() == "# newer unrelated work\n"
    assert not list(backups.iterdir())


def test_rollback_does_not_overwrite_later_change(controller, monkeypatch):
    module, package, _, backups = controller
    monkeypatch.setattr(module, "restart_and_verify", lambda: None)
    module.install()
    path = package / "server/routes.py"
    path.write_text("# subsequent change\n")
    with pytest.raises(ValueError, match="newer_installed_change_preserved"):
        module.rollback(next(backups.iterdir()))
    assert path.read_text() == "# subsequent change\n"


def test_wrong_grant_owner_is_denied(store, monkeypatch):
    store[1]()
    original = approval.os.fstat

    def wrong_owner(fd):
        result = original(fd)
        if stat.S_ISREG(result.st_mode):
            result.st_uid = 1001
        return result

    monkeypatch.setattr(approval.os, "fstat", wrong_owner)
    with pytest.raises(approval.ApprovalDenied):
        load()


def test_request_messages_cannot_be_replaced(store):
    store[1]()
    with pytest.raises(approval.ApprovalDenied):
        approval.reserve(
            GRANT_ID, "test", [{"role": "user", "content": "another task"}]
        )


def test_existing_capability_denial_is_preserved(store):
    store[1]()
    value = agent()
    value._executor._capability_policy = SimpleNamespace(check=lambda *_: False)
    result = _handle_agent(value, "test", request())
    assert result.execution["failed_count"] == 1
    assert "denied for" in result.execution["tools"][0]["output"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["stream", "client_tools", "no_agent"])
async def test_unsupported_endpoint_mode_never_dispatches(store, mode):
    from fastapi import HTTPException

    from openjarvis.server.routes import chat_completions

    req = request()
    value = agent()
    value._tools = [SensitiveTool()]
    if mode == "stream":
        req.stream = True
    elif mode == "client_tools":
        req.tools = [{"type": "function"}]
    else:
        value = None
    http = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(engine=None, agent=value))
    )
    with pytest.raises(HTTPException) as error:
        await chat_completions(req, http)
    assert error.value.status_code == 400


def test_real_shell_exec_requires_and_consumes_exact_grant(store):
    from openjarvis.tools.shell_exec import ShellExecTool

    store[1]()
    value = agent()
    value._executor._tools["shell_exec"] = ShellExecTool()
    result = _handle_agent(value, "test", request())
    assert result.execution["failed_count"] == 0
    assert "approved" in result.execution["tools"][0]["output"]
    denied = _handle_agent(value, "test", request(None))
    assert denied.execution["failed_count"] == 1


@pytest.mark.skipif(os.geteuid() != 0, reason="Actual UID separation requires root")
def test_real_root_service_uid_separation():
    import shutil
    import subprocess
    import sys
    import tempfile

    root = Path(tempfile.mkdtemp(prefix="firbo-approval-uid-test-"))
    root.chmod(0o755)
    try:
        (root / "grants").mkdir(mode=0o711)
        (root / "used").mkdir(mode=0o700)
        try:
            os.chown(root / "used", 65534, 65534)
        except OSError as error:
            if error.errno == 22 and not os.environ.get("FIRBO_REQUIRE_UID_TEST"):
                pytest.skip(
                    "Local user namespace does not map service UID; CI requires this test"
                )
            raise
        grant = {
            "schema": "firbo-native-approval/v1",
            "id": GRANT_ID,
            "uid": 65534,
            "request_sha256": approval.request_digest("test", []),
            "tool": "shell_exec",
            "arguments": ARGS,
            "created_at": int(time.time()),
            "expires_at": int(time.time()) + 60,
        }
        grant_path = root / "grants" / (GRANT_ID + ".key")
        grant_path.write_text(json.dumps(grant))
        grant_path.chmod(0o644)
        # The runner's checkout parent is private. Stage the exact runtime bytes
        # in this root-owned traversable directory, as in the real installation.
        source = root / "native_approval.py"
        source.write_bytes(Path(approval.__file__).read_bytes())
        source.chmod(0o644)
        program = """import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("approval", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.ROOT = pathlib.Path(sys.argv[2])
callback = m.reserve(sys.argv[3], "test", [])
assert callback(sys.argv[4])
assert not callback(sys.argv[4])
try:
    m.reserve(sys.argv[3], "test", [])
except m.ApprovalDenied:
    pass
else:
    raise AssertionError("replayed")
try:
    (m.ROOT / "grants" / "forged.key").write_text("forged")
except PermissionError:
    pass
else:
    raise AssertionError("service could issue grant")
print("root_service_boundary_verified")
"""
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                "-c",
                program,
                str(source),
                str(root),
                GRANT_ID,
                prompt(),
            ],
            user=65534,
            group=65534,
            extra_groups=[],
            cwd=root,
            env={"PATH": "/usr/bin:/bin"},
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "root_service_boundary_verified"
    finally:
        shutil.rmtree(root)
