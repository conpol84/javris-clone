"""Standalone Firbo AI gateway API.

A small FastAPI app that serves only the read-only AI-gateway endpoints for the
Firbo AI front end. Unlike ``jarvis serve`` it needs no inference engine, so it
starts even when the gateway is unreachable or its key is wrong.

Run: ``uvicorn openjarvis.server.firbo_app:app --host 0.0.0.0 --port 8000``

Environment: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (required, requests must
carry a valid Firbo login), OPENJARVIS_CORS_ORIGINS (comma-separated origins),
plus the OMNIROUTE_* variables documented in ``gateway_routes``.
"""

from __future__ import annotations

import os
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from openjarvis.server.gateway_routes import router as gateway_router
from openjarvis.server.gateway_routes import supabase_auth_enabled


def _require_login_configured() -> None:
    # Fail closed: without Supabase there is nothing to verify logins against.
    if not supabase_auth_enabled():
        raise HTTPException(status_code=503, detail="Firbo login is not configured")


def create_app() -> FastAPI:
    app = FastAPI(title="Firbo AI gateway API", docs_url=None, redoc_url=None)
    origins = [
        o.strip()
        for o in os.environ.get("OPENJARVIS_CORS_ORIGINS", "").split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(gateway_router, dependencies=[Depends(_require_login_configured)])

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok"}

    return app


app = create_app()
