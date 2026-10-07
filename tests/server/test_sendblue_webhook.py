"""Integration tests for the SendBlue webhook endpoint.

Tests the /webhooks/sendblue route, health check endpoint, and the
full flow from incoming webhook -> bridge -> agent -> send response.
"""

from __future__ import annotations

import threading
from unittest.mock import MagicMock

import pytest

pytest.importorskip("fastapi", reason="openjarvis[server] not installed")

from fastapi import FastAPI  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

from openjarvis.core.registry import ChannelRegistry  # noqa: E402


def _connected_synthetic_sendblue(**kwargs):
    """Keep webhook background replies on an instance-bound synthetic sender."""
    from openjarvis.channels.sendblue import SendBlueChannel

    ch = SendBlueChannel(**kwargs)
    # Background tasks can outlive a fixture-scoped HTTP patch. Bind the mock
    # to the test instance permanently so no delayed reply can reach SendBlue.
    ch.send = MagicMock(return_value=True)
    ch.connect()
    return ch


@pytest.fixture(autouse=True)
def _register_sendblue():
    from openjarvis.channels.sendblue import SendBlueChannel

    if not ChannelRegistry.contains("sendblue"):
        ChannelRegistry.register_value("sendblue", SendBlueChannel)


@pytest.fixture
def mock_bridge():
    bridge = MagicMock()
    bridge.handle_incoming.return_value = "Here are your results..."
    return bridge


@pytest.fixture
def sendblue_channel():
    return _connected_synthetic_sendblue(
        api_key_id="synthetic_key",
        api_secret_key="synthetic_secret",
        from_number="+12025550100",
        # Webhooks now fail closed without a secret, so configure one and have
        # the test client send the matching header by default.
        webhook_secret="testsecret",
    )


@pytest.fixture
def webhook_app(mock_bridge, sendblue_channel):
    from openjarvis.server.webhook_routes import create_webhook_router

    app = FastAPI()
    router = create_webhook_router(
        bridge=mock_bridge,
        sendblue_channel=sendblue_channel,
    )
    app.include_router(router)
    return app


@pytest.fixture
def client(webhook_app):
    # Send the webhook secret by default so message-handling tests reach the
    # bridge; fail-closed behavior is covered separately below.
    with TestClient(webhook_app, headers={"x-sendblue-secret": "testsecret"}) as c:
        yield c


# ---------------------------------------------------------------------------
# Webhook endpoint
# ---------------------------------------------------------------------------


class TestSendBlueWebhook:
    def test_incoming_message_returns_200(self, client, sendblue_channel, mock_bridge):
        reply_done = threading.Event()

        def synthetic_send(_recipient, content, **_kwargs):
            if content == "Here are your results...":
                reply_done.set()
            return True

        assert isinstance(sendblue_channel.send, MagicMock)
        sendblue_channel.send.side_effect = synthetic_send
        resp = client.post(
            "/webhooks/sendblue",
            json={
                "from_number": "+12025550101",
                "to_number": "+12025550100",
                "content": "Hello Jarvis",
                "message_handle": "msg-001",
                "is_outbound": False,
                "status": "RECEIVED",
                "service": "iMessage",
            },
        )
        assert resp.status_code == 200
        assert reply_done.wait(timeout=2), "Synthetic reply did not finish"
        mock_bridge.handle_incoming.assert_called_once_with(
            "+12025550101", "Hello Jarvis", "sendblue"
        )
        assert sendblue_channel.send.call_args_list == [
            (("+12025550101", "Message received! Working on it now..."), {}),
            (("+12025550101", "Here are your results..."), {}),
        ]

    def test_outbound_status_callback_ignored(self, client, mock_bridge):
        resp = client.post(
            "/webhooks/sendblue",
            json={
                "from_number": "+12025550100",
                "content": "Sent message",
                "is_outbound": True,
            },
        )
        assert resp.status_code == 200
        mock_bridge.handle_incoming.assert_not_called()

    def test_empty_content_ignored(self, client, mock_bridge):
        resp = client.post(
            "/webhooks/sendblue",
            json={
                "from_number": "+12025550101",
                "content": "",
                "is_outbound": False,
            },
        )
        assert resp.status_code == 200
        mock_bridge.handle_incoming.assert_not_called()

    def test_missing_from_number_ignored(self, client, mock_bridge):
        resp = client.post(
            "/webhooks/sendblue",
            json={
                "content": "Hello",
                "is_outbound": False,
            },
        )
        assert resp.status_code == 200
        mock_bridge.handle_incoming.assert_not_called()

    def test_webhook_secret_validation(self, mock_bridge):
        """When a webhook secret is set, reject requests without it."""
        from openjarvis.server.webhook_routes import create_webhook_router

        ch = _connected_synthetic_sendblue(
            api_key_id="synthetic_key",
            api_secret_key="synthetic_secret",
            from_number="+12025550100",
            webhook_secret="mysecret",
        )

        app = FastAPI()
        router = create_webhook_router(bridge=mock_bridge, sendblue_channel=ch)
        app.include_router(router)
        c = TestClient(app)

        # Without secret header -> rejected
        resp = c.post(
            "/webhooks/sendblue",
            json={
                "from_number": "+12025550101",
                "content": "Hello",
                "is_outbound": False,
            },
        )
        assert resp.status_code == 403

        # With correct secret -> accepted
        resp = c.post(
            "/webhooks/sendblue",
            json={
                "from_number": "+12025550101",
                "content": "Hello",
                "is_outbound": False,
                "message_handle": "msg-002",
            },
            headers={"x-sendblue-secret": "mysecret"},
        )
        assert resp.status_code == 200

    def test_no_bridge_returns_200(self, sendblue_channel):
        """When no bridge exists, webhook should not crash."""
        from openjarvis.server.webhook_routes import create_webhook_router

        app = FastAPI()
        router = create_webhook_router(bridge=None, sendblue_channel=sendblue_channel)
        app.include_router(router)
        c = TestClient(app, headers={"x-sendblue-secret": "testsecret"})

        resp = c.post(
            "/webhooks/sendblue",
            json={
                "from_number": "+12025550101",
                "content": "Hello",
                "is_outbound": False,
            },
        )
        assert resp.status_code == 200

    def test_no_secret_configured_is_rejected(self, mock_bridge):
        """Fail closed: a channel without a webhook_secret rejects all posts."""
        from openjarvis.server.webhook_routes import create_webhook_router

        ch = _connected_synthetic_sendblue(
            api_key_id="synthetic_key",
            api_secret_key="synthetic_secret",
            from_number="+12025550100",
        )
        app = FastAPI()
        router = create_webhook_router(bridge=mock_bridge, sendblue_channel=ch)
        app.include_router(router)
        c = TestClient(app)

        resp = c.post(
            "/webhooks/sendblue",
            json={"from_number": "+12025550101", "content": "Hi", "is_outbound": False},
        )
        assert resp.status_code == 403
        mock_bridge.handle_incoming.assert_not_called()


# ---------------------------------------------------------------------------
# Health endpoint (requires agent_manager_routes)
# ---------------------------------------------------------------------------


class TestSendBlueHealth:
    @pytest.fixture
    def health_app(self, sendblue_channel):
        app = FastAPI()
        app.state.sendblue_channel = sendblue_channel
        app.state.channel_bridge = MagicMock()
        app.state.channel_bridge._channels = {"sendblue": sendblue_channel}

        from openjarvis.server.agent_manager_routes import (
            create_agent_manager_router,
        )

        mgr = MagicMock()
        mgr.list_agents.return_value = []
        routers = create_agent_manager_router(mgr)
        sendblue_router = routers[4]  # 5th element is sendblue_router
        app.include_router(sendblue_router)
        return app

    def test_health_ready(self, health_app):
        c = TestClient(health_app)
        resp = c.get("/v1/channels/sendblue/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["channel_connected"] is True
        assert data["bridge_wired"] is True
        assert data["ready"] is True

    def test_health_not_ready(self):
        app = FastAPI()
        # No sendblue_channel or bridge on state

        from openjarvis.server.agent_manager_routes import (
            create_agent_manager_router,
        )

        mgr = MagicMock()
        mgr.list_agents.return_value = []
        routers = create_agent_manager_router(mgr)
        sendblue_router = routers[4]
        app.include_router(sendblue_router)

        c = TestClient(app)
        resp = c.get("/v1/channels/sendblue/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ready"] is False
