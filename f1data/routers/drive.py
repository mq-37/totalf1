"""FastAPI router for Apex POV (/drive + /api/drive/*)."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse

from .. import drive_db as ddb
from .. import drive_engine as deng
from .. import drive_paddock as dpaddock
from .. import server as srv
from ..circuits import CIRCUITS_META

router = APIRouter()


def _base_dir():
    return srv._career_base_dir()


@router.get("/drive", response_class=HTMLResponse)
async def drive_page(
    request: Request,
    mode: str = Query("timetrial"),
    circuit: str = Query("melbourne"),
    era: str = Query("2026"),
    weather: str = Query("dry"),
    team: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    ref_id: Optional[str] = Query(None),
):
    eras = [
        {"key": k, "label": v["label"], "top_speed": v["top_speed_kph"], "gears": v["gears"]}
        for k, v in deng.DRIVE_PHYSICS_DNA.items()
        if k not in ("karting", "f4", "f3", "f2")
    ]
    teams = [{"name": t[0], "color": t[1], "rating": t[2]} for t in deng.DEFAULT_2026_TEAMS]
    careers = ddb.list_careers(_base_dir())
    return srv.render_template(
        request,
        "drive.html",
        {
            "circuits_meta": CIRCUITS_META,
            "eras": eras,
            "teams": teams,
            "careers": careers,
            "boot_params": {
                "mode": mode,
                "circuit": circuit,
                "era": era,
                "weather": weather,
                "team": team or "",
                "source": source or "",
                "ref_id": ref_id or "",
            },
        },
    )


@router.get("/api/drive/config")
def api_drive_config(
    circuit: str = Query("melbourne"),
    era: str = Query("2026"),
    year: Optional[int] = Query(None),
    team: str = Query("McLaren"),
    driver: str = Query("Alex Vance"),
    code3: str = Query("VAN"),
    number: int = Query(27),
    mode: str = Query("timetrial"),
    weather: str = Query("dry"),
    laps: Optional[int] = Query(None),
    ai_difficulty: int = Query(78),
    source: Optional[str] = Query(None),
    ref_id: Optional[str] = Query(None),
):
    cfg = deng.build_drive_session_config(
        _base_dir(),
        circuit_id=circuit,
        era_key=era,
        year=year,
        player_team=team,
        player_name=driver,
        player_code3=code3,
        player_number=number,
        mode=mode,
        weather_mode=weather,
        laps=laps,
        ai_difficulty=ai_difficulty,
        source=source,
        ref_id=ref_id,
    )
    return JSONResponse(cfg)


@router.get("/api/drive/leaderboards")
def api_drive_leaderboards(circuit: Optional[str] = Query(None), limit: int = Query(40)):
    rows = ddb.list_time_trials(_base_dir(), circuit_id=circuit, limit=limit)
    return JSONResponse({"ok": True, "count": len(rows), "records": rows})


@router.post("/api/drive/timetrial/commit")
async def api_drive_tt_commit(request: Request):
    body = await request.json()
    if not isinstance(body, dict) or not body.get("circuit_id") or not body.get("best_lap_ms"):
        raise HTTPException(status_code=400, detail="circuit_id and best_lap_ms required")
    res = ddb.save_time_trial(
        _base_dir(),
        circuit_id=str(body["circuit_id"]),
        era_key=str(body.get("era_key") or "2026"),
        driver_name=str(body.get("driver_name") or "Alex Vance"),
        team_name=str(body.get("team_name") or "McLaren"),
        best_lap_ms=int(body["best_lap_ms"]),
        s1_ms=int(body.get("s1_ms") or 0),
        s2_ms=int(body.get("s2_ms") or 0),
        s3_ms=int(body.get("s3_ms") or 0),
        assists=body.get("assists") if isinstance(body.get("assists"), dict) else {},
        ghost=body.get("ghost") if isinstance(body.get("ghost"), list) else [],
        telemetry=body.get("telemetry") if isinstance(body.get("telemetry"), dict) else {},
    )
    return JSONResponse({"ok": True, **res})


@router.get("/api/drive/careers")
def api_drive_careers():
    return JSONResponse({"ok": True, "careers": ddb.list_careers(_base_dir())})


@router.post("/api/drive/career/new")
async def api_drive_career_new(request: Request):
    body = await request.json()
    st = deng.build_new_driver_career(
        driver_name=str(body.get("driver_name") or "Alex Vance"),
        driver_number=int(body.get("driver_number") or 27),
        team_name=str(body.get("team_name") or "Williams"),
        era_key=str(body.get("era_key") or "2026"),
        helmet_color=str(body.get("helmet_color") or "#38bdf8"),
        season_rounds=int(body.get("season_rounds") or 10),
    )
    sid = ddb.save_career(_base_dir(), st)
    return JSONResponse({"ok": True, "save_id": sid, "view": deng.serialize_career_view(st)})


@router.get("/api/drive/career/{save_id}")
def api_drive_career_get(save_id: str):
    st = ddb.load_career(_base_dir(), save_id)
    if not st:
        raise HTTPException(status_code=404, detail="Driver career not found")
    hist = ddb.list_race_history(_base_dir(), save_id, limit=30)
    return JSONResponse({"ok": True, "view": deng.serialize_career_view(st), "history": hist})


@router.delete("/api/drive/career/{save_id}")
def api_drive_career_delete(save_id: str):
    ok = ddb.delete_career(_base_dir(), save_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Driver career not found")
    return JSONResponse({"ok": True})


@router.post("/api/drive/career/{save_id}/race/commit")
async def api_drive_career_commit(save_id: str, request: Request):
    st = ddb.load_career(_base_dir(), save_id)
    if not st:
        raise HTTPException(status_code=404, detail="Driver career not found")
    body = await request.json()
    pre_season = int(st.get("season") or 1)
    res = deng.commit_driver_career_race(
        st,
        standings=body.get("standings") or [],
        player_grid_pos=int(body.get("player_grid_pos") or 10),
        best_lap_ms=int(body.get("best_lap_ms") or 0),
        fastest_lap_driver_id=body.get("fastest_lap_driver_id"),
    )
    ddb.append_race_history(
        _base_dir(),
        save_id,
        season=pre_season,
        round_num=res["round"],
        circuit_id=res["circuit_id"],
        grid_pos=int(body.get("player_grid_pos") or 10),
        finish_pos=res["player_pos"],
        best_lap_ms=res["best_lap_ms"],
        points_scored=res["points_scored"],
        summary=res,
    )
    ddb.save_career(_base_dir(), st)
    return JSONResponse({**res, "view": deng.serialize_career_view(st)})


@router.post("/api/drive/career/{save_id}/contract/sign")
async def api_drive_career_contract(save_id: str, request: Request):
    st = ddb.load_career(_base_dir(), save_id)
    if not st:
        raise HTTPException(status_code=404, detail="Driver career not found")
    body = await request.json()
    ok, msg = deng.sign_driver_career_contract(st, str(body.get("team_name") or ""))
    if ok:
        ddb.save_career(_base_dir(), st)
    return JSONResponse({"ok": ok, "message": msg, "view": deng.serialize_career_view(st)})


@router.get("/api/drive/paddock")
def api_drive_paddock(
    save_id: Optional[str] = Query(None),
    circuit: str = Query("melbourne"),
    era: str = Query("2026"),
    team: str = Query("McLaren"),
    driver: str = Query("Alex Vance"),
):
    st = ddb.load_career(_base_dir(), save_id) if save_id else None
    payload = dpaddock.build_paddock_payload(
        _base_dir(),
        career_state=st,
        circuit_id=circuit,
        era_key=era,
        team_name=team,
        driver_name=driver,
    )
    return JSONResponse(payload)


@router.post("/api/drive/career/{save_id}/story/choose")
async def api_drive_story_choose(save_id: str, request: Request):
    st = ddb.load_career(_base_dir(), save_id)
    if not st:
        raise HTTPException(status_code=404, detail="Driver career not found")
    body = await request.json()
    ok, msg, extra = dpaddock.resolve_story_choice(
        st,
        str(body.get("story_id") or ""),
        str(body.get("choice_id") or ""),
    )
    if ok:
        ddb.save_career(_base_dir(), st)
    paddock = dpaddock.build_paddock_payload(_base_dir(), career_state=st)
    return JSONResponse({"ok": ok, "message": msg, **extra, "view": deng.serialize_career_view(st), "paddock": paddock})


@router.post("/api/drive/career/{save_id}/commitment")
async def api_drive_commitment(save_id: str, request: Request):
    st = ddb.load_career(_base_dir(), save_id)
    if not st:
        raise HTTPException(status_code=404, detail="Driver career not found")
    body = await request.json()
    ok, msg, extra = dpaddock.execute_commitment(st, str(body.get("commitment_id") or ""))
    if ok:
        ddb.save_career(_base_dir(), st)
    paddock = dpaddock.build_paddock_payload(_base_dir(), career_state=st)
    return JSONResponse({"ok": ok, "message": msg, **extra, "view": deng.serialize_career_view(st), "paddock": paddock})
