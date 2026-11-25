"""SQLite WAL relational persistence for Apex POV (/drive).

Stores:
  - drive_time_trials: Per-(circuit, era) personal best laps, sector splits, ghost polylines & telemetry traces
  - drive_careers: Persistent POV Driver Career saves (seat, WDC/WCC standings, Acclaim, Teammate H2H, contracts)
  - drive_race_history: Per-race archive for Driver Career & Grand Prix finishes
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


def drive_db_path(base_dir: Path) -> Path:
    return Path(base_dir) / "data" / "drive_saves.sqlite"


def _connect(base_dir: Path) -> sqlite3.Connection:
    p = drive_db_path(base_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(p), timeout=15.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA synchronous=NORMAL")
    _init_schema(con)
    return con


def _init_schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS drive_time_trials (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            circuit_id      TEXT NOT NULL,
            era_key         TEXT NOT NULL,
            driver_name     TEXT NOT NULL,
            team_name       TEXT NOT NULL,
            best_lap_ms     INTEGER NOT NULL,
            s1_ms           INTEGER NOT NULL DEFAULT 0,
            s2_ms           INTEGER NOT NULL DEFAULT 0,
            s3_ms           INTEGER NOT NULL DEFAULT 0,
            assists_json    TEXT NOT NULL DEFAULT '{}',
            ghost_json      TEXT NOT NULL DEFAULT '[]',
            telemetry_json  TEXT NOT NULL DEFAULT '{}',
            updated_at      REAL NOT NULL,
            UNIQUE(circuit_id, era_key)
        );
        CREATE INDEX IF NOT EXISTS idx_drive_tt_circuit_era
            ON drive_time_trials(circuit_id, era_key, best_lap_ms ASC);

        CREATE TABLE IF NOT EXISTS drive_careers (
            save_id             TEXT PRIMARY KEY,
            driver_name         TEXT NOT NULL,
            driver_number       INTEGER NOT NULL DEFAULT 27,
            team_name           TEXT NOT NULL,
            era_key             TEXT NOT NULL DEFAULT '2026',
            season              INTEGER NOT NULL DEFAULT 1,
            round               INTEGER NOT NULL DEFAULT 1,
            points              REAL NOT NULL DEFAULT 0,
            acclaim             INTEGER NOT NULL DEFAULT 15,
            teammate_h2h_wins   INTEGER NOT NULL DEFAULT 0,
            teammate_h2h_losses INTEGER NOT NULL DEFAULT 0,
            state_json          TEXT NOT NULL,
            created_at          REAL NOT NULL,
            updated_at          REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS drive_race_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            save_id         TEXT NOT NULL,
            season          INTEGER NOT NULL,
            round           INTEGER NOT NULL,
            circuit_id      TEXT NOT NULL,
            grid_pos        INTEGER NOT NULL DEFAULT 1,
            finish_pos      INTEGER NOT NULL DEFAULT 1,
            best_lap_ms     INTEGER NOT NULL DEFAULT 0,
            points_scored   REAL NOT NULL DEFAULT 0,
            summary_json    TEXT NOT NULL DEFAULT '{}',
            created_at      REAL NOT NULL,
            FOREIGN KEY (save_id) REFERENCES drive_careers(save_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_drive_hist_save
            ON drive_race_history(save_id, season DESC, round DESC);
        """
    )


def save_time_trial(
    base_dir: Path,
    *,
    circuit_id: str,
    era_key: str,
    driver_name: str,
    team_name: str,
    best_lap_ms: int,
    s1_ms: int = 0,
    s2_ms: int = 0,
    s3_ms: int = 0,
    assists: dict[str, Any] | None = None,
    ghost: list[dict[str, Any]] | None = None,
    telemetry: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Upsert personal best lap + ghost polyline if faster than existing record."""
    now = time.time()
    lap_ms = max(1000, int(best_lap_ms))
    with _connect(base_dir) as con:
        cur = con.execute(
            "SELECT best_lap_ms FROM drive_time_trials WHERE circuit_id=? AND era_key=?",
            (circuit_id, era_key),
        ).fetchone()
        is_pb = cur is None or lap_ms < int(cur["best_lap_ms"])
        if is_pb:
            con.execute(
                """
                INSERT INTO drive_time_trials (
                    circuit_id, era_key, driver_name, team_name,
                    best_lap_ms, s1_ms, s2_ms, s3_ms,
                    assists_json, ghost_json, telemetry_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(circuit_id, era_key) DO UPDATE SET
                    driver_name=excluded.driver_name,
                    team_name=excluded.team_name,
                    best_lap_ms=excluded.best_lap_ms,
                    s1_ms=excluded.s1_ms,
                    s2_ms=excluded.s2_ms,
                    s3_ms=excluded.s3_ms,
                    assists_json=excluded.assists_json,
                    ghost_json=excluded.ghost_json,
                    telemetry_json=excluded.telemetry_json,
                    updated_at=excluded.updated_at
                """,
                (
                    circuit_id,
                    era_key,
                    driver_name[:40],
                    team_name[:48],
                    lap_ms,
                    int(s1_ms),
                    int(s2_ms),
                    int(s3_ms),
                    json.dumps(assists or {}, separators=(",", ":")),
                    json.dumps((ghost or [])[:900], separators=(",", ":")),
                    json.dumps(telemetry or {}, separators=(",", ":")),
                    now,
                ),
            )
            con.commit()
        best_now = lap_ms if is_pb else int(cur["best_lap_ms"])
    return {"is_pb": is_pb, "best_lap_ms": best_now, "submitted_lap_ms": lap_ms}


def load_time_trial(base_dir: Path, circuit_id: str, era_key: str) -> dict[str, Any] | None:
    with _connect(base_dir) as con:
        row = con.execute(
            "SELECT * FROM drive_time_trials WHERE circuit_id=? AND era_key=?",
            (circuit_id, era_key),
        ).fetchone()
    if not row:
        return None
    return {
        "circuit_id": row["circuit_id"],
        "era_key": row["era_key"],
        "driver_name": row["driver_name"],
        "team_name": row["team_name"],
        "best_lap_ms": int(row["best_lap_ms"]),
        "s1_ms": int(row["s1_ms"]),
        "s2_ms": int(row["s2_ms"]),
        "s3_ms": int(row["s3_ms"]),
        "assists": json.loads(row["assists_json"] or "{}"),
        "ghost": json.loads(row["ghost_json"] or "[]"),
        "telemetry": json.loads(row["telemetry_json"] or "{}"),
        "updated_at": float(row["updated_at"]),
    }


def list_time_trials(base_dir: Path, circuit_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    with _connect(base_dir) as con:
        if circuit_id:
            rows = con.execute(
                """
                SELECT circuit_id, era_key, driver_name, team_name, best_lap_ms, s1_ms, s2_ms, s3_ms, assists_json, updated_at
                FROM drive_time_trials WHERE circuit_id=? ORDER BY best_lap_ms ASC LIMIT ?
                """,
                (circuit_id, max(1, min(200, int(limit)))),
            ).fetchall()
        else:
            rows = con.execute(
                """
                SELECT circuit_id, era_key, driver_name, team_name, best_lap_ms, s1_ms, s2_ms, s3_ms, assists_json, updated_at
                FROM drive_time_trials ORDER BY updated_at DESC LIMIT ?
                """,
                (max(1, min(200, int(limit))),),
            ).fetchall()
    return [
        {
            "circuit_id": r["circuit_id"],
            "era_key": r["era_key"],
            "driver_name": r["driver_name"],
            "team_name": r["team_name"],
            "best_lap_ms": int(r["best_lap_ms"]),
            "s1_ms": int(r["s1_ms"]),
            "s2_ms": int(r["s2_ms"]),
            "s3_ms": int(r["s3_ms"]),
            "assists": json.loads(r["assists_json"] or "{}"),
            "updated_at": float(r["updated_at"]),
        }
        for r in rows
    ]


def save_career(base_dir: Path, state: dict[str, Any]) -> str:
    now = time.time()
    sid = str(state.get("save_id") or uuid.uuid4().hex[:10])
    state["save_id"] = sid
    p = state.get("player") or {}
    with _connect(base_dir) as con:
        con.execute(
            """
            INSERT INTO drive_careers (
                save_id, driver_name, driver_number, team_name, era_key,
                season, round, points, acclaim,
                teammate_h2h_wins, teammate_h2h_losses,
                state_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(save_id) DO UPDATE SET
                driver_name=excluded.driver_name,
                driver_number=excluded.driver_number,
                team_name=excluded.team_name,
                era_key=excluded.era_key,
                season=excluded.season,
                round=excluded.round,
                points=excluded.points,
                acclaim=excluded.acclaim,
                teammate_h2h_wins=excluded.teammate_h2h_wins,
                teammate_h2h_losses=excluded.teammate_h2h_losses,
                state_json=excluded.state_json,
                updated_at=excluded.updated_at
            """,
            (
                sid,
                str(p.get("name") or "Alex Vance"),
                int(p.get("number") or 27),
                str(p.get("team") or "McLaren"),
                str(state.get("era_key") or "2026"),
                int(state.get("season") or 1),
                int(state.get("round") or 1),
                float(p.get("points") or 0.0),
                int(p.get("acclaim") or 15),
                int(p.get("h2h_wins") or 0),
                int(p.get("h2h_losses") or 0),
                json.dumps(state, separators=(",", ":")),
                float(state.get("created_at") or now),
                now,
            ),
        )
        con.commit()
    return sid


def load_career(base_dir: Path, save_id: str) -> dict[str, Any] | None:
    with _connect(base_dir) as con:
        row = con.execute("SELECT state_json FROM drive_careers WHERE save_id=?", (save_id,)).fetchone()
    if not row:
        return None
    return json.loads(row["state_json"])


def list_careers(base_dir: Path) -> list[dict[str, Any]]:
    with _connect(base_dir) as con:
        rows = con.execute(
            """
            SELECT save_id, driver_name, driver_number, team_name, era_key,
                   season, round, points, acclaim, teammate_h2h_wins, teammate_h2h_losses, updated_at
            FROM drive_careers ORDER BY updated_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def delete_career(base_dir: Path, save_id: str) -> bool:
    with _connect(base_dir) as con:
        cur = con.execute("DELETE FROM drive_careers WHERE save_id=?", (save_id,))
        con.commit()
        return cur.rowcount > 0


def append_race_history(
    base_dir: Path,
    save_id: str,
    *,
    season: int,
    round_num: int,
    circuit_id: str,
    grid_pos: int,
    finish_pos: int,
    best_lap_ms: int,
    points_scored: float,
    summary: dict[str, Any],
) -> None:
    with _connect(base_dir) as con:
        con.execute(
            """
            INSERT INTO drive_race_history (
                save_id, season, round, circuit_id, grid_pos, finish_pos,
                best_lap_ms, points_scored, summary_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                save_id,
                int(season),
                int(round_num),
                str(circuit_id),
                int(grid_pos),
                int(finish_pos),
                int(best_lap_ms),
                float(points_scored),
                json.dumps(summary, separators=(",", ":")),
                time.time(),
            ),
        )
        con.commit()


def list_race_history(base_dir: Path, save_id: str, limit: int = 40) -> list[dict[str, Any]]:
    with _connect(base_dir) as con:
        rows = con.execute(
            """
            SELECT season, round, circuit_id, grid_pos, finish_pos, best_lap_ms, points_scored, summary_json, created_at
            FROM drive_race_history WHERE save_id=? ORDER BY season DESC, round DESC LIMIT ?
            """,
            (save_id, max(1, min(100, int(limit)))),
        ).fetchall()
    return [
        {
            "season": int(r["season"]),
            "round": int(r["round"]),
            "circuit_id": r["circuit_id"],
            "grid_pos": int(r["grid_pos"]),
            "finish_pos": int(r["finish_pos"]),
            "best_lap_ms": int(r["best_lap_ms"]),
            "points_scored": float(r["points_scored"]),
            "summary": json.loads(r["summary_json"] or "{}"),
            "created_at": float(r["created_at"]),
        }
        for r in rows
    ]


def check_drive_integrity(base_dir: Path) -> dict[str, Any]:
    required = ["drive_time_trials", "drive_careers", "drive_race_history"]
    try:
        with _connect(base_dir) as con:
            jm = str(con.execute("PRAGMA journal_mode").fetchone()[0]).lower()
            existing = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
            missing = [t for t in required if t not in existing]
            counts = {t: int(con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) for t in required if t in existing}
        return {
            "ok": jm == "wal" and not missing,
            "journal_mode": jm,
            "required_tables": required,
            "missing_tables": missing,
            "row_counts": counts,
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
