"""FastAPI router for Pit Wall: The Ladder (/ladder + /api/ladder/*)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .. import ladder_db as ldb
from .. import ladder_engine as leng
from .. import server as srv

router = APIRouter()


def _base_dir():
    return srv._career_base_dir()


def _load_or_404(save_id: str) -> dict:
    st = ldb.load_save(_base_dir(), save_id)
    if not st:
        raise HTTPException(status_code=404, detail="Ladder career save not found")
    return st


@router.get("/ladder", response_class=HTMLResponse)
async def ladder_page(request: Request):
    saves = ldb.list_saves(_base_dir())
    return srv.render_template(request, "ladder.html", {
            "saves": saves,
            "tiers_meta": [
                {
                    "id": tid,
                    "rank": leng.TIER_CONFIG[tid]["rank"],
                    "name": leng.TIER_CONFIG[tid]["name"],
                    "short": leng.TIER_CONFIG[tid]["short"],
                    "color": leng.TIER_CONFIG[tid]["color"],
                    "machinery": leng.TIER_CONFIG[tid]["machinery"],
                    "headline": leng.TIER_CONFIG[tid]["headline"],
                }
                for tid in leng.TIER_ORDER
            ],
        },
    )


@router.get("/api/ladder/saves")
def api_ladder_saves():
    return JSONResponse({"ok": True, "saves": ldb.list_saves(_base_dir())})


@router.post("/api/ladder/new")
async def api_ladder_new(request: Request):
    body = await request.json()
    state = leng.build_new_ladder(
        team_name=str(body.get("team_name") or "Apex Motorsport"),
        principal_name=str(body.get("principal_name") or "Alex Vance"),
        start_tier=str(body.get("start_tier") or "karting"),
        color=str(body.get("color") or "#e10600"),
    )
    sid = ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": True, "save_id": sid, "view": leng.serialize_ladder_view(state)})


@router.get("/api/ladder/state/{save_id}")
def api_ladder_state(save_id: str):
    state = _load_or_404(save_id)
    return JSONResponse({"ok": True, "view": leng.serialize_ladder_view(state)})


@router.delete("/api/ladder/state/{save_id}")
def api_ladder_delete(save_id: str):
    ok = ldb.delete_save(_base_dir(), save_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Save not found")
    return JSONResponse({"ok": True})


@router.post("/api/ladder/{save_id}/setup")
async def api_ladder_setup(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    res = leng.apply_setup_and_practice(state, body if isinstance(body, dict) else {})
    ldb.save_state(_base_dir(), state)
    return JSONResponse({**res, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/qualify")
async def api_ladder_qualify(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    tactic = str((body or {}).get("tactic") or "clean_air")
    res = leng.run_qualifying(state, tactic=tactic)
    ldb.save_state(_base_dir(), state)
    return JSONResponse({**res, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/race/commit")
async def api_ladder_race_commit(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    standings = body.get("standings") or []
    telemetry = body.get("telemetry") or {}
    res = leng.commit_race_results(state, standings, telemetry=telemetry)
    ldb.save_state(_base_dir(), state)
    return JSONResponse({**res, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/race/quick")
def api_ladder_race_quick(save_id: str):
    state = _load_or_404(save_id)
    res = leng.quick_sim_race(state)
    ldb.save_state(_base_dir(), state)
    return JSONResponse({**res, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/facility/upgrade")
async def api_ladder_facility(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.upgrade_facility(state, str(body.get("facility_id") or ""))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/scout")
async def api_ladder_scout(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.scout_driver(state, str(body.get("driver_id") or ""))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/driver/sign")
async def api_ladder_sign_driver(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.sign_driver(state, str(body.get("driver_id") or ""), replace_idx=int(body.get("seat_idx") or 0))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/staff/poach")
async def api_ladder_poach_staff(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.poach_staff(state, str(body.get("staff_id") or ""))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/academy/deal")
async def api_ladder_academy(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.sign_academy_deal(state, str(body.get("offer_id") or ""))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/rd/develop")
async def api_ladder_rd(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.develop_f1_upgrade(state, str(body.get("vector") or ""), str(body.get("name") or ""))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/fia/vote")
async def api_ladder_fia_vote(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.vote_fia_proposal(state, str(body.get("vote") or "yes"))
    if ok:
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})


@router.post("/api/ladder/{save_id}/fork/choose")
async def api_ladder_fork(save_id: str, request: Request):
    state = _load_or_404(save_id)
    body = await request.json()
    ok, msg = leng.choose_career_fork_or_promote(
        state,
        str(body.get("action") or "stay"),
        target_f1_team=body.get("target_f1_team"),
    )
    if ok:
        if state.get("season_history"):
            ldb.record_season_history(_base_dir(), save_id, state["season_history"][0])
        ldb.save_state(_base_dir(), state)
    return JSONResponse({"ok": ok, "message": msg, "view": leng.serialize_ladder_view(state)})
