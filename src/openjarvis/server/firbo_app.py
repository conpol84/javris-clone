"""Firbo API: one verified Firbo identity for native OmniRoute administration."""
from __future__ import annotations

import os
from typing import Any
from uuid import uuid4

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from openjarvis.server.firbo_control import guard_legacy_gateway, router as control_router
from openjarvis.server.gateway_routes import router as gateway_router


class ControlRequestBoundary:
    """Bound control bodies and prevent caching authenticated gateway responses."""
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request_id = str(uuid4())

        async def safe_send(message: Any) -> None:
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in {b"cache-control", b"x-request-id"}]
                message = {**message, "headers": headers + [(b"cache-control", b"no-store"), (b"x-request-id", request_id.encode())]}
            await send(message)

        if scope["method"] in {"POST", "PUT", "PATCH"}:
            chunks: list[bytes] = []
            length = 0
            while True:
                event = await receive()
                if event["type"] == "http.disconnect":
                    return
                chunk = event.get("body", b"")
                length += len(chunk)
                if length > 65_536:
                    await JSONResponse({"detail": "request_too_large"}, 413)(scope, receive, safe_send)
                    return
                chunks.append(chunk)
                if not event.get("more_body", False):
                    break
            consumed = False

            async def replay() -> Any:
                nonlocal consumed
                if not consumed:
                    consumed = True
                    return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
                return await receive()

            await self.app(scope, replay, safe_send)
        else:
            await self.app(scope, receive, safe_send)


def create_app() -> FastAPI:
    app = FastAPI(title="Firbo AI gateway API", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(ControlRequestBoundary)
    origins = [s.strip() for s in os.environ.get("OPENJARVIS_CORS_ORIGINS", "").split(",") if s.strip() and s.strip() != "*"]
    app.add_middleware(CORSMiddleware, allow_origins=origins,
                       allow_methods=["GET", "POST", "OPTIONS"],
                       allow_headers=["Authorization", "Content-Type"],
                       expose_headers=["X-Request-ID"])
    app.include_router(control_router)
    # These endpoints expose GLOBAL infrastructure, not individual company data.
    app.include_router(gateway_router, dependencies=[Depends(guard_legacy_gateway)])

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "contract": "firbo-control/v1"}

    return app


app = create_app()
