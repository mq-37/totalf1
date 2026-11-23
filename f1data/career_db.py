"""
Dedicated SQLite Persistence Engine for F1 Team Principal Career Saves & Unified Player Profile.

Stored at `data/career_saves.sqlite` (WAL mode, ACID transactions, PRAGMA user_version migrations),
completely isolated from the read-only historical F1 database (`data/f1.sqlite`).

Features:
- Unlimited named Career Save Slots with optimistic concurrency (`save_version`) & per-slot RLock
- Automatic zero-data-loss migration of legacy `data/career_state.json` into Slot #1 (with `.bak` copy)
- Rolling Auto-Checkpoints (keeps last 8 per slot) with 1-click Rollback
- Crash/refresh-proof Mid-Race Autosave snapshots (per leader lap)
- Permanent Grand Prix Race Reports (full classification, tyre stints, telemetry, ratings)
- Portable JSON Export / Import
- Unified Player Profile & 20-Achievement Trophy Cabinet shared by /play and /career
"""
from __future__ import annotations

from contextlib import contextmanager
import json
import shutil
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
MAX_CHECKPOINTS_PER_SLOT = 8
MAX_IMPORT_BYTES = 5 * 1024 * 1024


class VersionConflictError(RuntimeError):
    """Raised when optimistic concurrency save_version does not match DB."""


_LOCKS_GUARD = threading.Lock()
_DB_LOCKS: dict[str, threading.RLock] = {}

ACHIEVEMENT_DEFS: list[dict[str, Any]] = [
    {"id": "lights_out",     "name": "Lights Out Rookie",     "cat": "Career", "icon": "fa-flag-checkered", "desc": "Complete your first Career Grand Prix"},
    {"id": "first_points",   "name": "On The Board",          "cat": "Career", "icon": "fa-star",           "desc": "Score your first Championship points in Career"},
    {"id": "first_podium",   "name": "Champagne Shower",      "cat": "Career", "icon": "fa-wine-glass",     "desc": "Finish on the Podium (Top 3) in a Career GP"},
    {"id": "first_win",      "name": "Grand Prix Winner",     "cat": "Career", "icon": "fa-trophy",         "desc": "Win a Formula 1 Grand Prix as Team Principal"},
    {"id": "one_two_finish", "name": "Clean Sweep 1–2",       "cat": "Career", "icon": "fa-crown",          "desc": "Score a 1–2 finish with both team cars"},
    {"id": "pole_sitter",    "name": "Saturday Specialist",   "cat": "Career", "icon": "fa-stopwatch",      "desc": "Take Pole Position in Q3 Qualifying"},
    {"id": "grand_chelem",   "name": "Grand Chelem",          "cat": "Career", "icon": "fa-gem",            "desc": "Win a Grand Prix from Pole with the Fastest Lap"},
    {"id": "rain_master",    "name": "Rain Master",           "cat": "Race",   "icon": "fa-cloud-rain",     "desc": "Win or podium in a Wet / Rain-affected Grand Prix"},
    {"id": "red_flag_ace",   "name": "Red Flag Strategist",   "cat": "Race",   "icon": "fa-exclamation",    "desc": "Finish in the points in a Red-Flagged Grand Prix"},
    {"id": "duel_victor",    "name": "Late Braker",           "cat": "Race",   "icon": "fa-fire",           "desc": "Win a high-stakes 3D Braking-Zone Duel during a Career GP"},
    {"id": "sprint_king",    "name": "Sprint King",           "cat": "Career", "icon": "fa-bolt",           "desc": "Win a Saturday F1 Sprint"},
    {"id": "wcc_champ",      "name": "Constructors Champion", "cat": "Career", "icon": "fa-shield-alt",     "desc": "Win the World Constructors' Championship"},
    {"id": "wdc_champ",      "name": "Drivers Champion",      "cat": "Career", "icon": "fa-medal",          "desc": "Guide one of your drivers to the World Drivers' Title"},
    {"id": "dynasty_builder","name": "Dynasty Builder",       "cat": "Career", "icon": "fa-landmark",       "desc": "Complete 2 or more full Career Seasons"},
    {"id": "wind_wizard",    "name": "Wind Tunnel Wizard",    "cat": "HQ",     "icon": "fa-wind",           "desc": "Reach 90+ Car Overall Rating in Career Mode"},
    {"id": "silly_shark",    "name": "Silly Season Shark",    "cat": "HQ",     "icon": "fa-handshake",      "desc": "Sign or renew a driver contract in Career Mode"},
    {"id": "card_duelist",   "name": "Card Duelist",          "cat": "Play",   "icon": "fa-layer-group",    "desc": "Win 3 Card Battles in the 3D Battle Arena"},
    {"id": "hot_streak",     "name": "Unstoppable Streak",    "cat": "Play",   "icon": "fa-fire-alt",       "desc": "Reach a 3-win streak in Card Battles"},
    {"id": "mystery_savant", "name": "Paddock Historian",     "cat": "Play",   "icon": "fa-user-secret",    "desc": "Solve 3 Mystery Driver challenges"},
    {"id": "sim_strategist", "name": "Pit Wall Maestro",      "cat": "Play",   "icon": "fa-map-marked-alt", "desc": "Win a race in the 24-Circuit Track Simulator"},
]

PLAYER_RANKS: list[tuple[int, str]] = [
    (0,  "Pit Wall Rookie"),
    (3,  "Junior Race Engineer"),
    (6,  "Chief Strategist"),
    (10, "Sporting Director"),
    (14, "Team Principal"),
    (17, "World Champion"),
    (20, "F1 Hall of Fame Legend"),
]


def _db_path(base_dir: Path) -> Path:
    return base_dir / "data" / "career_saves.sqlite"


def _legacy_json_path(base_dir: Path) -> Path:
    return base_dir / "data" / "career_state.json"


def _get_lock(base_dir: Path) -> threading.RLock:
    key = str(_db_path(base_dir).resolve())
    with _LOCKS_GUARD:
        lk = _DB_LOCKS.get(key)
        if lk is None:
            lk = threading.RLock()
            _DB_LOCKS[key] = lk
        return lk


@contextmanager
def slot_lock(base_dir: Path):
    """Acquire the per-DB reentrant lock across a load -> mutate -> save critical section."""
    lk = _get_lock(base_dir)
    lk.acquire()
    try:
        yield
    finally:
        lk.release()


def _connect(base_dir: Path) -> sqlite3.Connection:
    p = _db_path(base_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p), timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    ver = conn.execute("PRAGMA user_version").fetchone()[0]
    if ver >= SCHEMA_VERSION:
        return
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS career_slots (
            slot_id TEXT PRIMARY KEY,
            slot_name TEXT NOT NULL,
            team_name TEXT NOT NULL DEFAULT '',
            team_color TEXT NOT NULL DEFAULT '#e10600',
            era TEXT NOT NULL DEFAULT '2026',
            season_num INTEGER NOT NULL DEFAULT 1,
            season_year INTEGER NOT NULL DEFAULT 2026,
            current_round INTEGER NOT NULL DEFAULT 1,
            total_rounds INTEGER NOT NULL DEFAULT 12,
            wcc_pos INTEGER NOT NULL DEFAULT 1,
            cash_m REAL NOT NULL DEFAULT 0.0,
            car_overall REAL NOT NULL DEFAULT 75.0,
            is_active INTEGER NOT NULL DEFAULT 0,
            save_version INTEGER NOT NULL DEFAULT 1,
            state_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS career_checkpoints (
            checkpoint_id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id TEXT NOT NULL REFERENCES career_slots(slot_id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            season_num INTEGER NOT NULL DEFAULT 1,
            round_num INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL,
            state_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ckpt_slot ON career_checkpoints(slot_id, checkpoint_id DESC);

        CREATE TABLE IF NOT EXISTS career_midrace (
            slot_id TEXT PRIMARY KEY REFERENCES career_slots(slot_id) ON DELETE CASCADE,
            season_num INTEGER NOT NULL,
            round_num INTEGER NOT NULL,
            circuit_id TEXT NOT NULL,
            lap INTEGER NOT NULL,
            total_laps INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            snapshot_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS career_race_reports (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id TEXT NOT NULL REFERENCES career_slots(slot_id) ON DELETE CASCADE,
            season_num INTEGER NOT NULL,
            round_num INTEGER NOT NULL,
            circuit_id TEXT NOT NULL,
            gp_name TEXT NOT NULL,
            winner_name TEXT NOT NULL DEFAULT '',
            winner_team TEXT NOT NULL DEFAULT '',
            fastest_lap_name TEXT NOT NULL DEFAULT '',
            weather_summary TEXT NOT NULL DEFAULT 'Dry',
            sc_count INTEGER NOT NULL DEFAULT 0,
            vsc_count INTEGER NOT NULL DEFAULT 0,
            red_flag_count INTEGER NOT NULL DEFAULT 0,
            report_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(slot_id, season_num, round_num)
        );
        CREATE INDEX IF NOT EXISTS idx_rep_slot ON career_race_reports(slot_id, season_num DESC, round_num DESC);

        CREATE TABLE IF NOT EXISTS player_profile (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            stats_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS player_achievements (
            achievement_id TEXT PRIMARY KEY,
            unlocked_at INTEGER NOT NULL,
            meta_json TEXT NOT NULL DEFAULT '{}'
        );
        """
    )
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()


def _extract_slot_meta(state: dict[str, Any]) -> dict[str, Any]:
    pid = state.get("player_team_id")
    teams = state.get("teams") or []
    pt = next((t for t in teams if t.get("id") == pid), teams[0] if teams else {})
    wcc = sorted(teams, key=lambda t: (-t.get("points", 0), -t.get("wins", 0), -t.get("car_overall", 0)))
    wcc_pos = next((i + 1 for i, t in enumerate(wcc) if t.get("id") == pt.get("id")), 1)
    cal = state.get("calendar") or []
    return {
        "team_name": str(pt.get("name") or "F1 Team"),
        "team_color": str(pt.get("color") or "#e10600"),
        "era": str(state.get("era") or "2026"),
        "season_num": int(state.get("season_num") or 1),
        "season_year": int(state.get("season_year") or 2026),
        "current_round": int(state.get("current_round") or 1),
        "total_rounds": max(1, len(cal)),
        "wcc_pos": wcc_pos,
        "cash_m": round(float(state.get("cash_m") or 0.0), 2),
        "car_overall": round(float(pt.get("car_overall") or 75.0), 1),
    }


def ensure_db(base_dir: Path) -> None:
    """Initialize SQLite schema & automatically migrate legacy career_state.json if present."""
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            _init_schema(conn)
            # Ensure player_profile singleton exists
            row = conn.execute("SELECT id FROM player_profile WHERE id=1").fetchone()
            if row is None:
                default_stats = {
                    "card_battles_played": 0,
                    "card_battles_won": 0,
                    "card_win_streak": 0,
                    "card_best_streak": 0,
                    "mystery_solved": 0,
                    "mystery_best_streak": 0,
                    "mystery_streak": 0,
                    "track_sim_races": 0,
                    "track_sim_wins": 0,
                    "track_sim_podiums": 0,
                    "career_races": 0,
                    "career_wins": 0,
                    "career_podiums": 0,
                    "career_poles": 0,
                    "career_seasons_completed": 0,
                    "career_wcc_titles": 0,
                    "career_wdc_titles": 0,
                    "duels_won": 0,
                }
                conn.execute(
                    "INSERT INTO player_profile(id, stats_json, updated_at) VALUES (1, ?, ?)",
                    (json.dumps(default_stats), int(time.time())),
                )
                conn.commit()

            # Zero-data-loss migration of legacy data/career_state.json -> Slot #1
            cnt = conn.execute("SELECT COUNT(*) FROM career_slots").fetchone()[0]
            leg = _legacy_json_path(base_dir)
            if cnt == 0 and leg.exists():
                try:
                    raw_text = leg.read_text(encoding="utf-8")
                    st = json.loads(raw_text)
                    if isinstance(st, dict) and st.get("teams"):
                        bak = leg.with_name("career_state.json.migrated.bak")
                        if not bak.exists():
                            shutil.copy2(leg, bak)
                        meta = _extract_slot_meta(st)
                        now = int(time.time())
                        slot_id = "slot_1"
                        st["_slot_id"] = slot_id
                        st["_save_version"] = 1
                        sjson = json.dumps(st, ensure_ascii=False)
                        conn.execute(
                            """
                            INSERT INTO career_slots(
                                slot_id, slot_name, team_name, team_color, era,
                                season_num, season_year, current_round, total_rounds,
                                wcc_pos, cash_m, car_overall, is_active, save_version,
                                state_json, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
                            """,
                            (
                                slot_id,
                                f"{meta['team_name']} (Career #1)",
                                meta["team_name"],
                                meta["team_color"],
                                meta["era"],
                                meta["season_num"],
                                meta["season_year"],
                                meta["current_round"],
                                meta["total_rounds"],
                                meta["wcc_pos"],
                                meta["cash_m"],
                                meta["car_overall"],
                                sjson,
                                int(st.get("created_at") or now),
                                now,
                            ),
                        )
                        conn.execute(
                            """
                            INSERT INTO career_checkpoints(slot_id, label, season_num, round_num, created_at, state_json)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (slot_id, f"Migrated · S{meta['season_num']} R{meta['current_round']}", meta["season_num"], meta["current_round"], now, sjson),
                        )
                        conn.commit()
                except Exception:
                    pass
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Career Slots CRUD + Checkpoints + Export/Import
# ---------------------------------------------------------------------------
def get_active_slot_id(base_dir: Path) -> str | None:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute("SELECT slot_id FROM career_slots WHERE is_active=1 ORDER BY updated_at DESC LIMIT 1").fetchone()
            if row:
                return row["slot_id"]
            row2 = conn.execute("SELECT slot_id FROM career_slots ORDER BY updated_at DESC LIMIT 1").fetchone()
            if row2:
                conn.execute("UPDATE career_slots SET is_active=1 WHERE slot_id=?", (row2["slot_id"],))
                conn.commit()
                return row2["slot_id"]
            return None
        finally:
            conn.close()


def load_active_career(base_dir: Path) -> dict[str, Any] | None:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute("SELECT slot_id, save_version, state_json FROM career_slots WHERE is_active=1 ORDER BY updated_at DESC LIMIT 1").fetchone()
            if not row:
                row = conn.execute("SELECT slot_id, save_version, state_json FROM career_slots ORDER BY updated_at DESC LIMIT 1").fetchone()
                if not row:
                    return None
                conn.execute("UPDATE career_slots SET is_active=1 WHERE slot_id=?", (row["slot_id"],))
                conn.commit()
            st = json.loads(row["state_json"])
            st["_slot_id"] = row["slot_id"]
            st["_save_version"] = int(row["save_version"])
            return st
        finally:
            conn.close()


def create_career_slot(base_dir: Path, state: dict[str, Any], slot_name: str | None = None, make_active: bool = True) -> str:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            now = int(time.time())
            meta = _extract_slot_meta(state)
            slot_id = f"slot_{uuid.uuid4().hex[:10]}"
            cnt = conn.execute("SELECT COUNT(*) FROM career_slots").fetchone()[0]
            name = (slot_name or f"{meta['team_name']} #{cnt + 1}").strip()[:48]
            state["_slot_id"] = slot_id
            state["_save_version"] = 1
            sjson = json.dumps(state, ensure_ascii=False)
            if make_active:
                conn.execute("UPDATE career_slots SET is_active=0")
            conn.execute(
                """
                INSERT INTO career_slots(
                    slot_id, slot_name, team_name, team_color, era,
                    season_num, season_year, current_round, total_rounds,
                    wcc_pos, cash_m, car_overall, is_active, save_version,
                    state_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    slot_id, name, meta["team_name"], meta["team_color"], meta["era"],
                    meta["season_num"], meta["season_year"], meta["current_round"], meta["total_rounds"],
                    meta["wcc_pos"], meta["cash_m"], meta["car_overall"],
                    1 if make_active else 0, sjson, now, now,
                ),
            )
            conn.execute(
                "INSERT INTO career_checkpoints(slot_id, label, season_num, round_num, created_at, state_json) VALUES (?, ?, ?, ?, ?, ?)",
                (slot_id, f"Start · S{meta['season_num']} R{meta['current_round']}", meta["season_num"], meta["current_round"], now, sjson),
            )
            conn.commit()
            return slot_id
        finally:
            conn.close()


def save_active_career(
    base_dir: Path,
    state: dict[str, Any],
    checkpoint_label: str | None = None,
    expected_version: int | None = None,
) -> int:
    """Persist state into its slot (creating a new slot if none exists), check optimistic version, increment save_version, optionally snapshot checkpoint."""
    ensure_db(base_dir)
    with _get_lock(base_dir):
        slot_id = state.get("_slot_id") or get_active_slot_id(base_dir)
        if not slot_id:
            create_career_slot(base_dir, state)
            return 1
        conn = _connect(base_dir)
        try:
            row = conn.execute("SELECT save_version FROM career_slots WHERE slot_id=?", (slot_id,)).fetchone()
            if not row:
                conn.close()
                create_career_slot(base_dir, state)
                return 1
            cur_ver = int(row["save_version"])
            if expected_version is not None and cur_ver != int(expected_version):
                raise VersionConflictError(
                    f"Career save was modified concurrently (expected v{expected_version}, current v{cur_ver})."
                )
            new_ver = cur_ver + 1
            now = int(time.time())
            meta = _extract_slot_meta(state)
            state["_slot_id"] = slot_id
            state["_save_version"] = new_ver
            sjson = json.dumps(state, ensure_ascii=False)
            conn.execute(
                """
                UPDATE career_slots
                SET team_name=?, team_color=?, era=?, season_num=?, season_year=?,
                    current_round=?, total_rounds=?, wcc_pos=?, cash_m=?, car_overall=?,
                    save_version=?, state_json=?, updated_at=?
                WHERE slot_id=?
                """,
                (
                    meta["team_name"], meta["team_color"], meta["era"], meta["season_num"], meta["season_year"],
                    meta["current_round"], meta["total_rounds"], meta["wcc_pos"], meta["cash_m"], meta["car_overall"],
                    new_ver, sjson, now, slot_id,
                ),
            )
            if checkpoint_label:
                conn.execute(
                    "INSERT INTO career_checkpoints(slot_id, label, season_num, round_num, created_at, state_json) VALUES (?, ?, ?, ?, ?, ?)",
                    (slot_id, checkpoint_label[:80], meta["season_num"], meta["current_round"], now, sjson),
                )
                # Keep last MAX_CHECKPOINTS_PER_SLOT checkpoints per slot
                conn.execute(
                    """
                    DELETE FROM career_checkpoints
                    WHERE slot_id=? AND checkpoint_id NOT IN (
                        SELECT checkpoint_id FROM career_checkpoints
                        WHERE slot_id=? ORDER BY checkpoint_id DESC LIMIT ?
                    )
                    """,
                    (slot_id, slot_id, MAX_CHECKPOINTS_PER_SLOT),
                )
            conn.commit()
            return new_ver
        finally:
            conn.close()


def list_slots(base_dir: Path) -> list[dict[str, Any]]:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            rows = conn.execute(
                """
                SELECT slot_id, slot_name, team_name, team_color, era,
                       season_num, season_year, current_round, total_rounds,
                       wcc_pos, cash_m, car_overall, is_active, save_version,
                       created_at, updated_at
                FROM career_slots
                ORDER BY is_active DESC, updated_at DESC
                """
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def switch_slot(base_dir: Path, slot_id: str) -> tuple[bool, str]:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute("SELECT slot_name FROM career_slots WHERE slot_id=?", (slot_id,)).fetchone()
            if not row:
                return False, "Save slot not found."
            conn.execute("UPDATE career_slots SET is_active=0")
            conn.execute("UPDATE career_slots SET is_active=1, updated_at=? WHERE slot_id=?", (int(time.time()), slot_id))
            conn.commit()
            return True, f"Loaded save slot: {row['slot_name']}"
        finally:
            conn.close()


def rename_slot(base_dir: Path, slot_id: str, new_name: str) -> tuple[bool, str]:
    ensure_db(base_dir)
    clean = (new_name or "").strip()[:48]
    if not clean:
        return False, "Save slot name cannot be empty."
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            cur = conn.execute("UPDATE career_slots SET slot_name=?, updated_at=? WHERE slot_id=?", (clean, int(time.time()), slot_id))
            conn.commit()
            if cur.rowcount == 0:
                return False, "Save slot not found."
            return True, f"Renamed save slot to '{clean}'."
        finally:
            conn.close()


def duplicate_slot(base_dir: Path, slot_id: str, new_name: str | None = None) -> tuple[bool, str, str | None]:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute("SELECT slot_name, state_json FROM career_slots WHERE slot_id=?", (slot_id,)).fetchone()
            if not row:
                return False, "Save slot not found.", None
            st = json.loads(row["state_json"])
            target_name = (new_name or f"{row['slot_name']} (Copy)").strip()[:48]
        finally:
            conn.close()
        new_id = create_career_slot(base_dir, st, slot_name=target_name, make_active=True)
        return True, f"Duplicated into '{target_name}'.", new_id


def delete_slot(base_dir: Path, slot_id: str) -> tuple[bool, str]:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute("SELECT slot_name, is_active FROM career_slots WHERE slot_id=?", (slot_id,)).fetchone()
            if not row:
                return False, "Save slot not found."
            conn.execute("DELETE FROM career_slots WHERE slot_id=?", (slot_id,))
            if row["is_active"]:
                nxt = conn.execute("SELECT slot_id FROM career_slots ORDER BY updated_at DESC LIMIT 1").fetchone()
                if nxt:
                    conn.execute("UPDATE career_slots SET is_active=1 WHERE slot_id=?", (nxt["slot_id"],))
            conn.commit()
            return True, f"Deleted save slot '{row['slot_name']}'."
        finally:
            conn.close()


def list_checkpoints(base_dir: Path, slot_id: str | None = None) -> list[dict[str, Any]]:
    ensure_db(base_dir)
    sid = slot_id or get_active_slot_id(base_dir)
    if not sid:
        return []
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            rows = conn.execute(
                """
                SELECT checkpoint_id, slot_id, label, season_num, round_num, created_at
                FROM career_checkpoints
                WHERE slot_id=?
                ORDER BY checkpoint_id DESC
                LIMIT ?
                """,
                (sid, MAX_CHECKPOINTS_PER_SLOT),
            ).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()


def restore_checkpoint(base_dir: Path, checkpoint_id: int) -> tuple[bool, str]:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute(
                "SELECT slot_id, label, state_json FROM career_checkpoints WHERE checkpoint_id=?",
                (int(checkpoint_id),),
            ).fetchone()
            if not row:
                return False, "Checkpoint not found."
            st = json.loads(row["state_json"])
            sid = row["slot_id"]
            st["_slot_id"] = sid
            conn.execute("DELETE FROM career_midrace WHERE slot_id=?", (sid,))
            conn.commit()
        finally:
            conn.close()
        save_active_career(base_dir, st)
        return True, f"Rolled back to checkpoint: {row['label']}"


def export_active_slot(base_dir: Path) -> dict[str, Any] | None:
    st = load_active_career(base_dir)
    if not st:
        return None
    sid = st.get("_slot_id")
    reports = list_race_reports(base_dir, sid) if sid else []
    return {
        "format": "local-f1-career-backup-v1",
        "exported_at": int(time.time()),
        "state": st,
        "race_reports": reports,
    }


def import_career_backup(base_dir: Path, payload: dict[str, Any], slot_name: str | None = None) -> tuple[bool, str]:
    if not isinstance(payload, dict):
        return False, "Invalid JSON backup file."
    try:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    except Exception:
        return False, "Backup payload is not JSON-serializable."
    if len(encoded) > MAX_IMPORT_BYTES:
        return False, "Backup file exceeds 5 MB safety limit."
    st = payload.get("state") if isinstance(payload.get("state"), dict) else payload
    if (
        not isinstance(st, dict)
        or not isinstance(st.get("teams"), list)
        or not st.get("teams")
        or not isinstance(st.get("drivers"), dict)
        or not st.get("drivers")
        or not isinstance(st.get("calendar"), list)
        or not st.get("calendar")
    ):
        return False, "Backup file does not contain a valid F1 Career state."
    st = dict(st)
    st.pop("_slot_id", None)
    sid = create_career_slot(base_dir, st, slot_name=slot_name, make_active=True)
    # Restore attached race reports if present
    for rep in (payload.get("race_reports") or []):
        if isinstance(rep, dict) and rep.get("season_num") and rep.get("round_num"):
            save_race_report(base_dir, sid, rep)
    return True, "Imported Career backup into a new save slot!"


# ---------------------------------------------------------------------------
# Mid-Race Autosave & Permanent Grand Prix Race Reports
# ---------------------------------------------------------------------------
def save_midrace_snapshot(base_dir: Path, slot_id: str, snapshot: dict[str, Any]) -> None:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            conn.execute(
                """
                INSERT INTO career_midrace(slot_id, season_num, round_num, circuit_id, lap, total_laps, updated_at, snapshot_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slot_id) DO UPDATE SET
                    season_num=excluded.season_num,
                    round_num=excluded.round_num,
                    circuit_id=excluded.circuit_id,
                    lap=excluded.lap,
                    total_laps=excluded.total_laps,
                    updated_at=excluded.updated_at,
                    snapshot_json=excluded.snapshot_json
                """,
                (
                    slot_id,
                    int(snapshot.get("season_num") or 1),
                    int(snapshot.get("round_num") or 1),
                    str(snapshot.get("circuit_id") or ""),
                    int(snapshot.get("lap") or 1),
                    int(snapshot.get("total_laps") or 15),
                    int(time.time()),
                    json.dumps(snapshot, ensure_ascii=False),
                ),
            )
            conn.commit()
        finally:
            conn.close()


def load_midrace_snapshot(base_dir: Path, slot_id: str | None = None) -> dict[str, Any] | None:
    ensure_db(base_dir)
    sid = slot_id or get_active_slot_id(base_dir)
    if not sid:
        return None
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute(
                "SELECT season_num, round_num, circuit_id, lap, total_laps, updated_at, snapshot_json FROM career_midrace WHERE slot_id=?",
                (sid,),
            ).fetchone()
            if not row:
                return None
            return {
                "season_num": row["season_num"],
                "round_num": row["round_num"],
                "circuit_id": row["circuit_id"],
                "lap": row["lap"],
                "total_laps": row["total_laps"],
                "updated_at": row["updated_at"],
                "snapshot": json.loads(row["snapshot_json"]),
            }
        finally:
            conn.close()


def clear_midrace_snapshot(base_dir: Path, slot_id: str | None = None) -> None:
    ensure_db(base_dir)
    sid = slot_id or get_active_slot_id(base_dir)
    if not sid:
        return
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            conn.execute("DELETE FROM career_midrace WHERE slot_id=?", (sid,))
            conn.commit()
        finally:
            conn.close()


def save_race_report(base_dir: Path, slot_id: str, report: dict[str, Any]) -> None:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            conn.execute(
                """
                INSERT INTO career_race_reports(
                    slot_id, season_num, round_num, circuit_id, gp_name,
                    winner_name, winner_team, fastest_lap_name, weather_summary,
                    sc_count, vsc_count, red_flag_count, report_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(slot_id, season_num, round_num) DO UPDATE SET
                    winner_name=excluded.winner_name,
                    winner_team=excluded.winner_team,
                    fastest_lap_name=excluded.fastest_lap_name,
                    weather_summary=excluded.weather_summary,
                    sc_count=excluded.sc_count,
                    vsc_count=excluded.vsc_count,
                    red_flag_count=excluded.red_flag_count,
                    report_json=excluded.report_json,
                    created_at=excluded.created_at
                """,
                (
                    slot_id,
                    int(report.get("season_num") or 1),
                    int(report.get("round_num") or 1),
                    str(report.get("circuit_id") or ""),
                    str(report.get("gp_name") or ""),
                    str(report.get("winner_name") or ""),
                    str(report.get("winner_team") or ""),
                    str(report.get("fastest_lap_name") or ""),
                    str(report.get("weather_summary") or "Dry"),
                    int(report.get("sc_count") or 0),
                    int(report.get("vsc_count") or 0),
                    int(report.get("red_flag_count") or 0),
                    json.dumps(report, ensure_ascii=False),
                    int(time.time()),
                ),
            )
            conn.commit()
        finally:
            conn.close()


def get_race_report(base_dir: Path, slot_id: str, season_num: int, round_num: int) -> dict[str, Any] | None:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            row = conn.execute(
                "SELECT report_json FROM career_race_reports WHERE slot_id=? AND season_num=? AND round_num=?",
                (slot_id, int(season_num), int(round_num)),
            ).fetchone()
            return json.loads(row["report_json"]) if row else None
        finally:
            conn.close()


def list_race_report_rounds(base_dir: Path, slot_id: str | None = None) -> list[dict[str, int]]:
    """Lightweight query returning only (season_num, round_num) without parsing full report JSON blobs."""
    ensure_db(base_dir)
    sid = slot_id or get_active_slot_id(base_dir)
    if not sid:
        return []
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            rows = conn.execute(
                "SELECT season_num, round_num FROM career_race_reports WHERE slot_id=? ORDER BY season_num DESC, round_num DESC",
                (sid,),
            ).fetchall()
            return [{"season_num": int(r["season_num"]), "round_num": int(r["round_num"])} for r in rows]
        finally:
            conn.close()


def list_race_reports(base_dir: Path, slot_id: str | None = None) -> list[dict[str, Any]]:
    ensure_db(base_dir)
    sid = slot_id or get_active_slot_id(base_dir)
    if not sid:
        return []
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            rows = conn.execute(
                "SELECT report_json FROM career_race_reports WHERE slot_id=? ORDER BY season_num DESC, round_num DESC",
                (sid,),
            ).fetchall()
            return [json.loads(r["report_json"]) for r in rows]
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# Unified Player Profile & 20-Achievement Trophy Cabinet (/play + /career)
# ---------------------------------------------------------------------------
def _rank_for_unlocks(count: int) -> str:
    rank = PLAYER_RANKS[0][1]
    for thresh, title in PLAYER_RANKS:
        if count >= thresh:
            rank = title
    return rank


def get_player_profile(base_dir: Path) -> dict[str, Any]:
    ensure_db(base_dir)
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            prow = conn.execute("SELECT stats_json FROM player_profile WHERE id=1").fetchone()
            stats = json.loads(prow["stats_json"]) if prow else {}
            arows = conn.execute("SELECT achievement_id, unlocked_at, meta_json FROM player_achievements").fetchall()
            unlocked_map = {r["achievement_id"]: {"unlocked_at": r["unlocked_at"], "meta": json.loads(r["meta_json"] or "{}")} for r in arows}
            achievements = []
            for adef in ACHIEVEMENT_DEFS:
                u = unlocked_map.get(adef["id"])
                achievements.append({
                    **adef,
                    "unlocked": u is not None,
                    "unlocked_at": u["unlocked_at"] if u else None,
                })
            unlocked_count = sum(1 for a in achievements if a["unlocked"])
            return {
                "stats": stats,
                "unlocked_count": unlocked_count,
                "total_count": len(ACHIEVEMENT_DEFS),
                "rank": _rank_for_unlocks(unlocked_count),
                "achievements": achievements,
            }
        finally:
            conn.close()


def record_profile_event(base_dir: Path, event_type: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Update unified lifetime stats across /play & /career and unlock any earned achievements."""
    ensure_db(base_dir)
    data = payload or {}
    newly_unlocked: list[dict[str, Any]] = []
    with _get_lock(base_dir):
        conn = _connect(base_dir)
        try:
            prow = conn.execute("SELECT stats_json FROM player_profile WHERE id=1").fetchone()
            stats = json.loads(prow["stats_json"]) if prow else {}
            existing = {r["achievement_id"] for r in conn.execute("SELECT achievement_id FROM player_achievements").fetchall()}

            def _grant(aid: str) -> None:
                if aid in existing:
                    return
                adef = next((a for a in ACHIEVEMENT_DEFS if a["id"] == aid), None)
                if not adef:
                    return
                now = int(time.time())
                conn.execute(
                    "INSERT OR IGNORE INTO player_achievements(achievement_id, unlocked_at, meta_json) VALUES (?, ?, ?)",
                    (aid, now, json.dumps({"event": event_type})),
                )
                existing.add(aid)
                newly_unlocked.append(adef)

            if event_type == "card_battle":
                stats["card_battles_played"] = int(stats.get("card_battles_played", 0)) + 1
                if data.get("won"):
                    stats["card_battles_won"] = int(stats.get("card_battles_won", 0)) + 1
                    stats["card_win_streak"] = int(stats.get("card_win_streak", 0)) + 1
                    stats["card_best_streak"] = max(int(stats.get("card_best_streak", 0)), stats["card_win_streak"])
                else:
                    stats["card_win_streak"] = 0
                if stats["card_battles_won"] >= 3:
                    _grant("card_duelist")
                if stats.get("card_best_streak", 0) >= 3:
                    _grant("hot_streak")

            elif event_type == "mystery_driver":
                if data.get("solved"):
                    stats["mystery_solved"] = int(stats.get("mystery_solved", 0)) + 1
                    stats["mystery_streak"] = int(stats.get("mystery_streak", 0)) + 1
                    stats["mystery_best_streak"] = max(int(stats.get("mystery_best_streak", 0)), stats["mystery_streak"])
                else:
                    stats["mystery_streak"] = 0
                if stats.get("mystery_solved", 0) >= 3:
                    _grant("mystery_savant")

            elif event_type == "track_sim":
                stats["track_sim_races"] = int(stats.get("track_sim_races", 0)) + 1
                pos = int(data.get("pos") or 99)
                if pos == 1:
                    stats["track_sim_wins"] = int(stats.get("track_sim_wins", 0)) + 1
                    _grant("sim_strategist")
                if pos <= 3:
                    stats["track_sim_podiums"] = int(stats.get("track_sim_podiums", 0)) + 1
                    if data.get("is_wet"):
                        _grant("rain_master")

            elif event_type == "career_race":
                stats["career_races"] = int(stats.get("career_races", 0)) + 1
                _grant("lights_out")
                finishes = [f for f in (data.get("player_finishes") or []) if not f.get("dnf")]
                best_p = min((int(f.get("pos") or 99) for f in finishes), default=99)
                if best_p <= 10:
                    _grant("first_points")
                    if int(data.get("red_flag_count") or 0) > 0:
                        _grant("red_flag_ace")
                if best_p <= 3:
                    stats["career_podiums"] = int(stats.get("career_podiums", 0)) + 1
                    _grant("first_podium")
                    if data.get("is_wet"):
                        _grant("rain_master")
                if best_p == 1:
                    stats["career_wins"] = int(stats.get("career_wins", 0)) + 1
                    _grant("first_win")
                    if data.get("from_pole") and data.get("player_fl"):
                        _grant("grand_chelem")
                if len(finishes) >= 2 and sorted(int(f["pos"]) for f in finishes)[:2] == [1, 2]:
                    _grant("one_two_finish")
                if float(data.get("car_overall") or 0) >= 90.0:
                    _grant("wind_wizard")

            elif event_type == "career_pole":
                stats["career_poles"] = int(stats.get("career_poles", 0)) + 1
                _grant("pole_sitter")

            elif event_type == "career_sprint_win":
                _grant("sprint_king")

            elif event_type == "career_duel_win":
                stats["duels_won"] = int(stats.get("duels_won", 0)) + 1
                _grant("duel_victor")

            elif event_type == "career_contract":
                _grant("silly_shark")

            elif event_type == "career_car_ovr":
                if float(data.get("car_overall") or 0) >= 90.0:
                    _grant("wind_wizard")

            elif event_type == "career_season_end":
                stats["career_seasons_completed"] = int(stats.get("career_seasons_completed", 0)) + 1
                if data.get("won_wcc"):
                    stats["career_wcc_titles"] = int(stats.get("career_wcc_titles", 0)) + 1
                    _grant("wcc_champ")
                if data.get("won_wdc"):
                    stats["career_wdc_titles"] = int(stats.get("career_wdc_titles", 0)) + 1
                    _grant("wdc_champ")
                if stats["career_seasons_completed"] >= 2:
                    _grant("dynasty_builder")

            conn.execute(
                "UPDATE player_profile SET stats_json=?, updated_at=? WHERE id=1",
                (json.dumps(stats), int(time.time())),
            )
            conn.commit()
        finally:
            conn.close()

    prof = get_player_profile(base_dir)
    prof["newly_unlocked"] = newly_unlocked
    return prof
