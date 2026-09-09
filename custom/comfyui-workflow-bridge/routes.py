"""HTTP API registration for the Chatbox workflow bridge."""

from __future__ import annotations

import json
from typing import Any

from aiohttp import web
from server import PromptServer

from .bridge_store import (
    BRIDGE_VERSION,
    MAX_WORKFLOW_BYTES,
    BridgeConflictError,
    BridgeValidationError,
    WorkflowBridgeStore,
)

routes = PromptServer.instance.routes


def _store(request: web.Request) -> WorkflowBridgeStore:
    user_root = PromptServer.instance.user_manager.get_request_user_filepath(request, None, create_dir=True)
    if not user_root:
        raise web.HTTPForbidden(text="Invalid ComfyUI user")
    return WorkflowBridgeStore(user_root)


async def _json_body(request: web.Request) -> dict[str, Any]:
    if request.content_length is not None and request.content_length > MAX_WORKFLOW_BYTES:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_WORKFLOW_BYTES, actual_size=request.content_length)
    if request.content_type != "application/json":
        raise web.HTTPUnsupportedMediaType(text="Expected application/json")
    raw = await request.read()
    if len(raw) > MAX_WORKFLOW_BYTES:
        raise web.HTTPRequestEntityTooLarge(max_size=MAX_WORKFLOW_BYTES, actual_size=len(raw))
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise web.HTTPBadRequest(text="Invalid JSON") from error
    if not isinstance(value, dict):
        raise web.HTTPBadRequest(text="Expected a JSON object")
    return value


def _error(error: Exception) -> web.Response:
    if isinstance(error, BridgeConflictError):
        return web.json_response({"error": "revision_conflict", "current": error.current}, status=409)
    if isinstance(error, BridgeValidationError):
        return web.json_response({"error": "invalid_workflow", "message": str(error)}, status=400)
    if isinstance(error, FileNotFoundError):
        return web.json_response({"error": "not_found"}, status=404)
    raise error


@routes.get("/chatbox-bridge/v1/health")
async def health(request: web.Request) -> web.Response:
    _store(request)
    return web.json_response({"ok": True, "version": BRIDGE_VERSION, "maxWorkflowBytes": MAX_WORKFLOW_BYTES})


@routes.get("/chatbox-bridge/v1/workflows")
async def list_workflows(request: web.Request) -> web.Response:
    store = _store(request)
    return web.json_response({"workflows": store.list(), "unmanaged": store.list_unmanaged()})


@routes.get("/chatbox-bridge/v1/workflows/{workflow_id}")
async def get_workflow(request: web.Request) -> web.Response:
    try:
        return web.json_response(_store(request).get(request.match_info["workflow_id"]))
    except Exception as error:
        return _error(error)


@routes.post("/chatbox-bridge/v1/workflows")
async def save_workflow(request: web.Request) -> web.Response:
    try:
        bundle = _store(request).save(await _json_body(request))
        return web.json_response(bundle, status=200)
    except Exception as error:
        return _error(error)


@routes.delete("/chatbox-bridge/v1/workflows/{workflow_id}")
async def delete_workflow(request: web.Request) -> web.Response:
    try:
        revision_text = request.query.get("expectedRevision", "")
        expected_revision = int(revision_text) if revision_text.isdigit() else None
        _store(request).delete(request.match_info["workflow_id"], expected_revision)
        return web.Response(status=204)
    except Exception as error:
        return _error(error)
