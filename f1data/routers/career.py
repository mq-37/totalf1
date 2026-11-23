from __future__ import annotations

from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Request, Query, Form, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse, Response, JSONResponse

from .. import server as srv
from ..db import Database

router = APIRouter()

from ..pdf import _render_cards_pdf
from .game import api_game_deck

from pydantic import BaseModel, Field, field_validator


class CareerMutationReq(BaseModel):
    expected_version: Optional[int] = Field(default=None, ge=1)


class CareerNewReq(BaseModel):
    era: str = Field(default="2026", max_length=24)
    team_choice: str = Field(default="Mercedes", max_length=64)
    custom_team_name: str = Field(default="Apex Racing GP", max_length=40)
    custom_color: str = Field(default="#e10600", max_length=16)
    budget_tier: str = Field(default="midfield", max_length=24)
    calendar_len: str = Field(default="12", max_length=8)
    slot_name: Optional[str] = Field(default=None, max_length=48)
    custom_season: Optional[dict] = None


class FeederRecruitReq(CareerMutationReq):
    feeder_id: str = Field(min_length=1, max_length=64)


class FacilityUpgradeReq(CareerMutationReq):
    facility_id: str = Field(min_length=1, max_length=40)


class RdStartReq(CareerMutationReq):
    part_id: str = Field(min_length=1, max_length=32)
    mode: str = Field(default="normal", max_length=20)


class PuSwapReq(CareerMutationReq):
    car_num: int = Field(ge=1, le=2)
    component: str = Field(min_length=2, max_length=16)


class ScoutAssignReq(CareerMutationReq):
    driver_id: str = Field(min_length=1, max_length=80)
    express: bool = False


class MarketOfferReq(CareerMutationReq):
    driver_id: str = Field(min_length=1, max_length=80)
    seat_slot: str = Field(default="seat2", max_length=16)
    salary_m: float = Field(ge=0.2, le=80.0)
    signing_bonus_m: float = Field(default=0.0, ge=0.0, le=50.0)
    years: int = Field(default=2, ge=1, le=3)


class DriverRenewReq(CareerMutationReq):
    driver_id: str = Field(min_length=1, max_length=80)
    salary_m: float = Field(ge=0.2, le=80.0)
    years: int = Field(default=2, ge=1, le=3)


class SponsorSignReq(CareerMutationReq):
    sponsor_id: str = Field(min_length=1, max_length=40)


class StaffHireReq(CareerMutationReq):
    candidate_id: str = Field(min_length=1, max_length=40)


class DriverFocusReq(CareerMutationReq):
    driver_id: str = Field(min_length=1, max_length=80)
    focus: str = Field(default="balanced", max_length=24)


class NextGenRdReq(CareerMutationReq):
    part_id: str = Field(min_length=1, max_length=32)


class DilemmaResolveReq(CareerMutationReq):
    choice_idx: int = Field(ge=0, le=10)


class RaceSetupReq(CareerMutationReq):
    wing: int = Field(default=50, ge=0, le=100)
    susp: int = Field(default=50, ge=0, le=100)
    diff: int = Field(default=50, ge=0, le=100)
    auto: bool = False


class QualiReq(CareerMutationReq):
    weather_mode: str = Field(default="dynamic", max_length=20)
    stage: str = Field(default="full", max_length=12)
    tyre_choice: str = Field(default="fresh", max_length=16)


class RaceCommitReq(CareerMutationReq):
    standings: list[dict] = Field(min_length=1)
    fastest_lap_driver_id: Optional[str] = None
    telemetry: Optional[dict] = None


class QuickSimReq(CareerMutationReq):
    weather_mode: str = Field(default="dynamic", max_length=20)


class SlotIdReq(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64)


class SlotRenameReq(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64)
    slot_name: str = Field(min_length=1, max_length=48)


class SlotDuplicateReq(BaseModel):
    slot_id: str = Field(min_length=1, max_length=64)
    slot_name: Optional[str] = Field(default=None, max_length=48)


class CheckpointRestoreReq(BaseModel):
    checkpoint_id: int = Field(ge=1)


class CareerImportReq(BaseModel):
    backup: dict
    slot_name: Optional[str] = Field(default=None, max_length=48)


class MidRaceAutosaveReq(BaseModel):
    snapshot: dict


class ProfileEventReq(BaseModel):
    event_type: str = Field(min_length=1, max_length=40)
    payload: dict = Field(default_factory=dict)


class TeamLiveryReq(CareerMutationReq):
    palette: dict[str, str]
    livery_style: str = Field(default="two-tone", max_length=24)
    car_era: str = Field(default="2020s", max_length=10)

    @field_validator("palette")
    @classmethod
    def _validate_palette_hex(cls, v: dict[str, str]) -> dict[str, str]:
        for k, col in (v or {}).items():
            if not srv._HEX_COLOR_RE.match(str(col or "").strip()):
                raise ValueError(f"Invalid hex colour for palette slot '{k}': expected #RRGGBB")
        return v


class MediaRespondReq(CareerMutationReq):
    choice_idx: int = Field(ge=0, le=4)


def _career_base_dir() -> Path:
    return srv.BASE_DIR


def _career_payload(state: dict | None, *, include_static: bool = False) -> dict:
    from .. import career as _career, feeders as _feeders
    if state:
        _feeders.ensure_feeder_state(state)
    payload = _career.serialize_career_payload(state, base_dir=srv._career_base_dir(), include_static=include_static)
    if state:
        payload["feeders"] = state.get("feeders")
        payload["ops_board"] = _feeders.build_team_ops_board(state)
    return payload


def _save_career_checked(base: Path, state: dict, *, checkpoint_label: str | None = None, expected_version: int | None = None) -> None:
    from .. import career as _career, career_db as _cdb
    try:
        _career.save_career(base, state, checkpoint_label=checkpoint_label, expected_version=expected_version)
    except _cdb.VersionConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/career", response_class=HTMLResponse)
async def career_page(request: Request):
    from .. import career as _career
    db = srv.get_db()
    seasons_all = [r["year"] for r in db._conn.execute("SELECT year FROM seasons ORDER BY year").fetchall()]
    latest = seasons_all[-1] if seasons_all else srv.CURRENT_SEASON
    teams_latest = [
        {"name": r["team"], "color": srv.get_team_colors(r["team"]).get("primary", "#64748b")}
        for r in db._conn.execute(
            "SELECT team, SUM(points) AS pts FROM drivers_standings WHERE year=? GROUP BY team ORDER BY pts DESC",
            (latest,),
        ).fetchall()
        if r["team"]
    ]
    payload = _career_payload(_career.load_career(srv._career_base_dir()), include_static=True)
    return srv.templates.TemplateResponse(
        "career.html",
        {
            "request": request,
            "latest_year": latest,
            "starter_teams": teams_latest,
            "career_boot": payload,
        },
    )


@router.get("/api/career/state")
def api_career_state():
    from .. import career as _career
    return _career_payload(_career.load_career(srv._career_base_dir()), include_static=True)


@router.get("/api/career/slots")
def api_career_slots():
    from .. import career_db as _cdb
    base = srv._career_base_dir()
    sid = _cdb.get_active_slot_id(base)
    return {
        "ok": True,
        "active_slot_id": sid,
        "slots": _cdb.list_slots(base),
        "checkpoints": _cdb.list_checkpoints(base, sid) if sid else [],
        "midrace": _cdb.load_midrace_snapshot(base, sid) if sid else None,
    }


@router.post("/api/career/slots/switch")
def api_career_slot_switch(req: SlotIdReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    ok, msg = _cdb.switch_slot(base, req.slot_id)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "message": msg, **_career_payload(_career.load_career(base))}


@router.post("/api/career/slots/rename")
def api_career_slot_rename(req: SlotRenameReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    ok, msg = _cdb.rename_slot(base, req.slot_id, req.slot_name)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "message": msg, **_career_payload(_career.load_career(base))}


@router.post("/api/career/slots/duplicate")
def api_career_slot_duplicate(req: SlotDuplicateReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    ok, msg, new_id = _cdb.duplicate_slot(base, req.slot_id, req.slot_name)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "message": msg, "slot_id": new_id, **_career_payload(_career.load_career(base))}


@router.post("/api/career/slots/delete")
def api_career_slot_delete(req: SlotIdReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    ok, msg = _cdb.delete_slot(base, req.slot_id)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "message": msg, **_career_payload(_career.load_career(base))}


@router.post("/api/career/checkpoint/restore")
def api_career_checkpoint_restore(req: CheckpointRestoreReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    ok, msg = _cdb.restore_checkpoint(base, req.checkpoint_id)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"ok": True, "message": msg, **_career_payload(_career.load_career(base))}


@router.get("/api/career/export")
def api_career_export():
    from .. import career_db as _cdb
    data = _cdb.export_active_slot(srv._career_base_dir())
    if not data:
        raise HTTPException(status_code=404, detail="No active career to export")
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": 'attachment; filename="local-f1-career-backup.json"'},
    )


@router.post("/api/career/import")
def api_career_import(req: CareerImportReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    ok, msg = _cdb.import_career_backup(base, req.backup, slot_name=req.slot_name)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"ok": True, "message": msg, **_career_payload(_career.load_career(base))}


@router.post("/api/career/new")
def api_career_new(req: CareerNewReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    season_deck = api_game_deck(source="season", year=None, decade=None, limit=0)["cards"]
    alltime_deck = api_game_deck(source="alltime", year=None, decade=None, limit=120)["cards"]
    state = _career.build_new_career(
        season_deck,
        alltime_deck,
        era=req.era,
        team_choice=req.team_choice,
        custom_team_name=req.custom_team_name,
        custom_color=req.custom_color,
        budget_tier=req.budget_tier,
        calendar_len=req.calendar_len,
    )
    if req.custom_season and isinstance(req.custom_season, dict):
        from ..circuits import CIRCUITS_BY_ID
        cs = req.custom_season
        cal_ids = cs.get("calendar") or []
        new_cal = []
        for idx_r, cid in enumerate(cal_ids, start=1):
            c = CIRCUITS_BY_ID.get(str(cid).lower())
            if c:
                new_cal.append({
                    "round": idx_r,
                    "circuit_id": c["id"],
                    "name": c["name"],
                    "gp": c.get("gp") or c["name"],
                    "country": c.get("country") or "",
                    "is_sprint": bool(c.get("is_sprint_2026")),
                    "completed": False,
                })
        if new_cal:
            state["calendar"] = new_cal
        state["custom_season_config"] = cs
        if cs.get("era_rules"):
            state["era_rules"] = cs["era_rules"]
        mkt = cs.get("market_rules") or {}
        if mkt.get("budget_cap_m"):
            state["cost_cap_m"] = float(mkt["budget_cap_m"])
    slot_id = _cdb.create_career_slot(base, state, slot_name=req.slot_name or (req.custom_season.get("name") if isinstance(req.custom_season, dict) else None), make_active=True)
    return {"ok": True, "slot_id": slot_id, "message": "New F1 Career created in a new Save Slot!", **_career_payload(_career.load_career(base))}


@router.post("/api/career/facility/upgrade")
def api_career_facility_upgrade(req: FacilityUpgradeReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.upgrade_facility(state, req.facility_id)
        newly_unlocked = []
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
            pt = _career.get_player_team(state)
            prof = _cdb.record_profile_event(base, "career_car_ovr", {"car_overall": pt["car_overall"]})
            newly_unlocked = prof.get("newly_unlocked") or []
        return {"ok": ok, "message": msg, "newly_unlocked": newly_unlocked, **_career_payload(state)}


@router.post("/api/career/rd/start")
def api_career_rd_start(req: RdStartReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.start_rd_project(state, req.part_id, req.mode)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/pu/swap")
def api_career_pu_swap(req: PuSwapReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.swap_pu_component(state, req.car_num, req.component)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/scout/assign")
def api_career_scout_assign(req: ScoutAssignReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.assign_scout(state, req.driver_id, req.express)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/market/offer")
def api_career_market_offer(req: MarketOfferReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.negotiate_contract(state, req.driver_id, req.seat_slot, req.salary_m, req.signing_bonus_m, req.years)
        newly_unlocked = []
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
            prof = _cdb.record_profile_event(base, "career_contract", {})
            newly_unlocked = prof.get("newly_unlocked") or []
        return {"ok": ok, "message": msg, "newly_unlocked": newly_unlocked, **_career_payload(state)}


@router.post("/api/career/driver/renew")
def api_career_driver_renew(req: DriverRenewReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.renew_driver_contract(state, req.driver_id, req.salary_m, req.years)
        newly_unlocked = []
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
            prof = _cdb.record_profile_event(base, "career_contract", {})
            newly_unlocked = prof.get("newly_unlocked") or []
        return {"ok": ok, "message": msg, "newly_unlocked": newly_unlocked, **_career_payload(state)}


@router.post("/api/career/sponsor/sign")
def api_career_sponsor_sign(req: SponsorSignReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.sign_sponsor(state, req.sponsor_id)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/race/qualify")
def api_career_qualify(req: QualiReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        cal_item = state["calendar"][state["current_round"] - 1]
        had_pq = bool(state.get("pending_quali") and state["pending_quali"].get("round") == state["current_round"])
        ckpt = None if had_pq else f"Pre-Quali · S{state['season_num']} R{state['current_round']} {cal_item['name']}"
        quali = _career.run_qualifying_stage(state, stage=req.stage, tyre_choice=req.tyre_choice, weather_mode=req.weather_mode)
        _save_career_checked(base, state, checkpoint_label=ckpt, expected_version=req.expected_version)

        newly_unlocked = []
        if quali.get("stage") == "done" and quali.get("grid"):
            if quali["grid"][0].get("is_player_team"):
                prof = _cdb.record_profile_event(base, "career_pole", {})
                newly_unlocked.extend(prof.get("newly_unlocked") or [])
            sp = quali.get("sprint_top8") or []
            if sp and sp[0].get("is_player_team"):
                prof2 = _cdb.record_profile_event(base, "career_sprint_win", {})
                newly_unlocked.extend(prof2.get("newly_unlocked") or [])
        return {"ok": True, "quali": quali, "newly_unlocked": newly_unlocked, **_career_payload(state)}


@router.post("/api/career/race/autosave")
def api_career_race_autosave(req: MidRaceAutosaveReq):
    from .. import career_db as _cdb
    base = srv._career_base_dir()
    sid = _cdb.get_active_slot_id(base)
    if not sid:
        raise HTTPException(status_code=404, detail="No active career slot")
    _cdb.save_midrace_snapshot(base, sid, req.snapshot)
    return {"ok": True}


@router.delete("/api/career/race/autosave")
def api_career_race_autosave_clear():
    from .. import career_db as _cdb
    base = srv._career_base_dir()
    _cdb.clear_midrace_snapshot(base)
    return {"ok": True}


@router.get("/api/career/race/report/{season_num}/{round_num}")
def api_career_race_report(season_num: int, round_num: int):
    from .. import career_db as _cdb
    base = srv._career_base_dir()
    sid = _cdb.get_active_slot_id(base)
    if not sid:
        raise HTTPException(status_code=404, detail="No active career")
    rep = _cdb.get_race_report(base, sid, season_num, round_num)
    if not rep:
        raise HTTPException(status_code=404, detail="Race report not found for that round")
    telem = _cdb.load_race_telemetry(base, season_num, round_num, slot_id=sid)
    return {"ok": True, "report": rep, "telemetry": telem}


def _finalize_race_commit_persistence(
    base: Path,
    state: dict,
    debrief: dict,
    *,
    expected_version: int | None = None,
    telemetry_payload: dict | None = None,
) -> list[dict]:
    from .. import career_db as _cdb, feeders as _feeders
    _feeders.simulate_feeder_round(state)
    ckpt_lbl = f"Post-Race · S{debrief['season_num']} R{debrief['round']} {debrief['gp'][:24]}"
    _save_career_checked(base, state, checkpoint_label=ckpt_lbl, expected_version=expected_version)
    sid = state.get("_slot_id") or _cdb.get_active_slot_id(base)
    if sid:
        _cdb.clear_midrace_snapshot(base, sid)
        if debrief.get("race_report"):
            _cdb.save_race_report(base, sid, debrief["race_report"])
        if telemetry_payload and isinstance(telemetry_payload, dict):
            _cdb.save_race_telemetry(base, int(debrief["season_num"]), int(debrief["round"]), telemetry_payload, slot_id=sid)

    newly = []
    prof = _cdb.record_profile_event(
        base,
        "career_race",
        {
            "player_finishes": debrief.get("player_finishes") or [],
            "from_pole": debrief.get("player_from_pole"),
            "player_fl": debrief.get("player_fl"),
            "is_wet": debrief.get("is_wet"),
            "red_flag_count": debrief.get("red_flag_count"),
            "car_overall": debrief.get("car_overall"),
        },
    )
    newly.extend(prof.get("newly_unlocked") or [])
    if debrief.get("season_complete"):
        prof2 = _cdb.record_profile_event(
            base,
            "career_season_end",
            {"won_wcc": debrief.get("won_wcc"), "won_wdc": debrief.get("won_wdc")},
        )
        newly.extend(prof2.get("newly_unlocked") or [])
    return newly


@router.post("/api/career/race/commit")
def api_career_commit_race(req: RaceCommitReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        try:
            debrief = _career.commit_race_result(
                state,
                req.standings,
                fastest_lap_driver_id=req.fastest_lap_driver_id,
                telemetry=req.telemetry,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        rec_payload = (req.telemetry or {}).get("recorder_payload") if isinstance(req.telemetry, dict) else None
        newly_unlocked = _finalize_race_commit_persistence(
            base,
            state,
            debrief,
            expected_version=req.expected_version,
            telemetry_payload=rec_payload,
        )
        return {"ok": True, "debrief": debrief, "newly_unlocked": newly_unlocked, **_career_payload(state)}


@router.post("/api/career/race/quicksim")
def api_career_quicksim(req: QuickSimReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        try:
            debrief = _career.quick_sim_race(state, weather_mode=req.weather_mode)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        newly_unlocked = _finalize_race_commit_persistence(
            base,
            state,
            debrief,
            expected_version=req.expected_version,
            telemetry_payload=None,
        )
        return {"ok": True, "debrief": debrief, "newly_unlocked": newly_unlocked, **_career_payload(state)}


@router.post("/api/career/season/advance")
def api_career_advance_season(req: Optional[CareerMutationReq] = None):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    exp_v = req.expected_version if req else None
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        res = _career.advance_to_next_season(state)
        _save_career_checked(base, state, checkpoint_label=f"Season {state['season_num']} Start", expected_version=exp_v)
        return {
            "ok": True,
            "message": f"Welcome to Season {state['season_num']}!",
            "silly_season_recap": res.get("silly_season_recap") or [],
            **_career_payload(state),
        }


@router.post("/api/career/staff/hire")
def api_career_staff_hire(req: StaffHireReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.hire_staff(state, req.candidate_id)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/driver/focus")
def api_career_driver_focus(req: DriverFocusReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.set_driver_focus(state, req.driver_id, req.focus)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/rd/nextgen")
def api_career_rd_nextgen(req: NextGenRdReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.start_nextgen_research(state, req.part_id)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/dilemma/resolve")
def api_career_dilemma_resolve(req: DilemmaResolveReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.resolve_dilemma(state, req.choice_idx)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/race/setup")
def api_career_race_setup(req: RaceSetupReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg, ws = _career.tune_weekend_setup(state, wing=req.wing, susp=req.susp, diff=req.diff, auto=req.auto)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, "weekend_setup": ws, **_career_payload(state)}


@router.post("/api/career/team/livery")
def api_career_team_livery(req: TeamLiveryReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.update_team_livery(state, req.palette, req.livery_style, req.car_era)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/academy/train")
def api_career_academy_train(req: Optional[CareerMutationReq] = None):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    exp_v = req.expected_version if req else None
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.train_reserve_driver(state)
        if ok:
            _save_career_checked(base, state, expected_version=exp_v)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/academy/discover")
def api_career_academy_discover(req: Optional[CareerMutationReq] = None):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    exp_v = req.expected_version if req else None
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.discover_academy_wonderkid(state)
        if ok:
            _save_career_checked(base, state, expected_version=exp_v)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/media/respond")
def api_career_media_respond(req: MediaRespondReq):
    from .. import career as _career, career_db as _cdb
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _career.respond_media_prompt(state, req.choice_idx)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/feeders/recruit")
def api_career_feeder_recruit(req: FeederRecruitReq):
    from .. import career as _career, career_db as _cdb, feeders as _feeders
    base = srv._career_base_dir()
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        ok, msg = _feeders.recruit_feeder_driver(state, req.feeder_id)
        if ok:
            _save_career_checked(base, state, expected_version=req.expected_version)
        return {"ok": ok, "message": msg, **_career_payload(state)}


@router.post("/api/career/feeders/sim-round")
def api_career_feeder_sim_round(req: Optional[CareerMutationReq] = None):
    from .. import career as _career, career_db as _cdb, feeders as _feeders
    base = srv._career_base_dir()
    exp_v = req.expected_version if req else None
    with _cdb.slot_lock(base):
        state = _career.load_career(base)
        if not state:
            raise HTTPException(status_code=404, detail="No active career")
        res = _feeders.simulate_feeder_round(state)
        _save_career_checked(base, state, expected_version=exp_v)
        w = res.get("winners") or {}
        msg = f"Feeder Round {res['rounds_completed']} complete! Winners: F2 {w.get('f2', '—')} · F3 {w.get('f3', '—')} · F1A {w.get('f1_academy', '—')}"
        return {"ok": True, "message": msg, **_career_payload(state)}


@router.get("/career/cards.pdf")
def career_team_cards_pdf(mode: str = Query("collector")):
    """Export printable Collector or Game Edition PDF cards for your active Career Team lineup & custom livery!"""
    from .. import career as _career
    base = srv._career_base_dir()
    state = _career.load_career(base)
    if not state:
        raise HTTPException(status_code=404, detail="No active career to export")
    _career._ensure_career_v2(state)
    pt = _career.get_player_team(state)
    db = srv.get_db()
    pal = pt.get("livery_palette") or {}
    t_cols = {
        "primary": pal.get("main") or pt.get("color") or "#e10600",
        "secondary": pal.get("secondary") or "#111622",
        "accent": pal.get("accent") or "#facc15",
    }
    era_str = str(pt.get("car_era") or "2020s")
    era_yr = int(era_str[:4]) + 5 if era_str[:4].isdigit() else int(state.get("season_year") or srv.CURRENT_SEASON)
    wcc_sorted = sorted(state["teams"], key=lambda t: (-t["points"], -t["wins"], -t["car_overall"]))
    p_wcc_pos = next((i + 1 for i, t in enumerate(wcc_sorted) if t["id"] == pt["id"]), 4)
    cpos = p_wcc_pos if p_wcc_pos <= 3 else 0

    # Build cards for Car #1, Car #2, Reserve Driver + Top Championship Rival (fills a full 2x2 foldable sheet!)
    selected_ids: list[tuple[str, str]] = []
    for i, did in enumerate(pt.get("driver_ids") or []):
        selected_ids.append((did, f"CAR #{i + 1}"))
    if pt.get("reserve_id"):
        selected_ids.append((pt["reserve_id"], "RESERVE"))
    # Fill to 4 cards with WDC leader / top rival
    if len(selected_ids) < 4:
        wdc_top = sorted(
            [d for d in state["drivers"].values() if d.get("team_id") and d["team_id"] != pt["id"] and d.get("role") == "race"],
            key=lambda d: (-int(d.get("season_pts") or 0), -float(d.get("overall") or 0)),
        )
        for rv in wdc_top:
            if len(selected_ids) >= 4:
                break
            selected_ids.append((rv["id"], "WDC RIVAL"))

    dyn_recs = (state.get("dynasty") or {}).get("driver_records") or {}
    team_map = {t["id"]: t for t in state["teams"]}
    out_cards: list[dict] = []
    for rank_i, (did, role_lbl) in enumerate(selected_ids, start=1):
        d = state["drivers"].get(did)
        if not d:
            continue
        is_own = d.get("team_id") == pt["id"]
        tm = team_map.get(d.get("team_id")) if d.get("team_id") else None
        cols = t_cols if is_own else srv.get_team_colors(tm["name"] if tm else (d.get("hero_team") or ""))
        if not is_own and tm and tm.get("color"):
            cols = {**cols, "primary": tm["color"]}
        t_name = pt["name"] if is_own else (tm["name"] if tm else "Free Agent")
        raw_drv = d.get("driver") or f"{d['clean_name']} {d.get('code3', '')}".strip()
        img = d.get("driver_image") or db.get_driver_image(raw_drv)
        drec = dyn_recs.get(d["clean_name"]) or {}
        tot_wins = int(d.get("wins") or 0) + int(drec.get("wins") or d.get("season_wins") or 0)
        tot_pods = int(d.get("podiums") or 0) + int(drec.get("podiums") or d.get("season_podiums") or 0)
        tot_fl = int(drec.get("fl") or d.get("season_fl") or 0)
        starts = max(1, int(drec.get("races") or state.get("current_round") or 1))
        st = d.get("stats") or {}
        out_cards.append({
            "driver": raw_drv,
            "nationality": d.get("nationality") or "",
            "team": t_name,
            "rank": rank_i,
            "position": rank_i,
            "overall": round(float(d.get("overall") or 75.0), 1),
            "points": int(d.get("season_pts") or 0),
            "wins": tot_wins,
            "podiums": tot_pods,
            "fastest_laps": tot_fl,
            "starts": starts,
            "dnfs": 0,
            "win_rate": round((tot_wins / max(1, starts)) * 100.0, 1),
            "podium_rate": round((tot_pods / max(1, starts)) * 100.0, 1),
            "fl_rate": round((tot_fl / max(1, starts)) * 100.0, 1),
            "top10_rate": 85.0,
            "seasons": int(d.get("seasons_exp") or 1),
            "years_active": f"S{state['season_num']} · {role_lbl}",
            "avatar_suit": cols.get("primary", "#e10600"),
            "avatar_helmet": cols.get("accent", "#facc15"),
            "avatar_accent": cols.get("secondary", "#111622"),
            "driver_image": img,
            "badges": [role_lbl, f"POT {d.get('potential', 80)}", d.get("trait") or "F1 Career"],
            "cars": [{
                "name": t_name,
                "colors": cols,
                "year": era_yr if is_own else int(state.get("season_year") or srv.CURRENT_SEASON),
                "position": rank_i,
                "points": int(d.get("season_pts") or 0),
                "wins": int(d.get("season_wins") or 0),
                "cpos": cpos if is_own else 0,
            }],
            "champion_years": [int(state["season_year"]) - i for i in range(int(d.get("championships") or 0))],
            "pace": st.get("pace", 75),
            "racecraft": st.get("racecraft", 75),
            "reliability": st.get("reliability", 80),
        })

    pdf_bytes = _render_cards_pdf(
        out_cards,
        title=f"{pt['name']} · Season {state['season_num']} ({state['season_year']})",
        size="fold",
        mode=mode,
    )
    slug = srv._slugify_name(pt["name"]) or "career-team"
    suffix = "-game" if (mode or "").lower() == "game" else ""
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={slug}-s{state['season_num']}{suffix}.pdf"},
    )


@router.get("/api/profile")
def api_player_profile():
    from .. import career_db as _cdb
    return {"ok": True, **_cdb.get_player_profile(srv._career_base_dir())}


@router.post("/api/profile/event")
def api_player_profile_event(req: ProfileEventReq):
    from .. import career_db as _cdb
    prof = _cdb.record_profile_event(srv._career_base_dir(), req.event_type, req.payload)
    return {"ok": True, **prof}


