"""Relational SQLite persistence for Pit Wall: The Ladder (multi-season 5-tier careers)."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any


def _db_path(base_dir: Path) -> Path:
    data_dir = base_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "ladder_saves.sqlite"


def _connect(base_dir: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(_db_path(base_dir)))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ladder_saves (
            save_id TEXT PRIMARY KEY,
            team_name TEXT NOT NULL,
            principal_name TEXT NOT NULL,
            tier TEXT NOT NULL,
            season INTEGER NOT NULL,
            round INTEGER NOT NULL,
            cash_k REAL NOT NULL,
            reputation REAL NOT NULL,
            career_path TEXT NOT NULL DEFAULT 'owner_ladder',
            state_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ladder_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            save_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            tier TEXT NOT NULL,
            team_name TEXT NOT NULL,
            team_pos INTEGER NOT NULL,
            champion_driver TEXT NOT NULL,
            points REAL NOT NULL,
            career_path TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ladder_history_save_season
        ON ladder_history(save_id, season DESC)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ladder_midrace (
            save_id TEXT PRIMARY KEY,
            season INTEGER NOT NULL,
            round INTEGER NOT NULL,
            tier TEXT NOT NULL,
            circuit_id TEXT NOT NULL,
            lap INTEGER NOT NULL,
            total_laps INTEGER NOT NULL,
            updated_at REAL NOT NULL,
            snapshot_json TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ladder_race_reports (
            report_id INTEGER PRIMARY KEY AUTOINCREMENT,
            save_id TEXT NOT NULL,
            season INTEGER NOT NULL,
            round INTEGER NOT NULL,
            tier TEXT NOT NULL,
            circuit_id TEXT NOT NULL,
            winner_name TEXT NOT NULL DEFAULT '',
            winner_team TEXT NOT NULL DEFAULT '',
            weather_summary TEXT NOT NULL DEFAULT 'Dry',
            sc_count INTEGER NOT NULL DEFAULT 0,
            report_json TEXT NOT NULL,
            created_at REAL NOT NULL,
            UNIQUE(save_id, season, round)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_ladder_reports_save_season
        ON ladder_race_reports(save_id, season DESC, round DESC)
    """)
    conn.commit()
    return conn


def list_saves(base_dir: Path) -> list[dict[str, Any]]:
    conn = _connect(base_dir)
    try:
        rows = conn.execute(
            """
            SELECT save_id, team_name, principal_name, tier, season, round,
                   cash_k, reputation, career_path, created_at, updated_at
            FROM ladder_saves
            ORDER BY updated_at DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def load_save(base_dir: Path, save_id: str) -> dict[str, Any] | None:
    conn = _connect(base_dir)
    try:
        row = conn.execute(
            "SELECT state_json FROM ladder_saves WHERE save_id = ?",
            (save_id,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row["state_json"])
    finally:
        conn.close()


def save_state(base_dir: Path, state: dict[str, Any]) -> str:
    conn = _connect(base_dir)
    try:
        now = time.time()
        sid = str(state.get("save_id") or uuid.uuid4().hex[:12])
        state["save_id"] = sid
        state["updated_at"] = now
        if not state.get("created_at"):
            state["created_at"] = now
        player = state.get("player", {})
        conn.execute(
            """
            INSERT INTO ladder_saves (
                save_id, team_name, principal_name, tier, season, round,
                cash_k, reputation, career_path, state_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(save_id) DO UPDATE SET
                team_name=excluded.team_name,
                principal_name=excluded.principal_name,
                tier=excluded.tier,
                season=excluded.season,
                round=excluded.round,
                cash_k=excluded.cash_k,
                reputation=excluded.reputation,
                career_path=excluded.career_path,
                state_json=excluded.state_json,
                updated_at=excluded.updated_at
            """,
            (
                sid,
                str(player.get("team_name") or "Apex Motorsport"),
                str(player.get("principal_name") or "Team Principal"),
                str(state.get("tier") or "karting"),
                int(state.get("season") or 1),
                int(state.get("round") or 1),
                float(state.get("economy", {}).get("cash_k") or 0.0),
                float(player.get("reputation") or 10.0),
                str(player.get("career_path") or "owner_ladder"),
                json.dumps(state),
                float(state["created_at"]),
                now,
            ),
        )
        conn.commit()
        return sid
    finally:
        conn.close()


def record_season_history(base_dir: Path, save_id: str, record: dict[str, Any]) -> None:
    conn = _connect(base_dir)
    try:
        conn.execute(
            """
            INSERT INTO ladder_history (
                save_id, season, tier, team_name, team_pos, champion_driver,
                points, career_path, summary_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                save_id,
                int(record.get("season") or 1),
                str(record.get("tier") or "karting"),
                str(record.get("team_name") or ""),
                int(record.get("team_pos") or 1),
                str(record.get("champion_driver") or ""),
                float(record.get("points") or 0.0),
                str(record.get("career_path") or "owner_ladder"),
                json.dumps(record),
                time.time(),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def get_season_history(base_dir: Path, save_id: str) -> list[dict[str, Any]]:
    conn = _connect(base_dir)
    try:
        rows = conn.execute(
            "SELECT summary_json FROM ladder_history WHERE save_id = ? ORDER BY season DESC",
            (save_id,),
        ).fetchall()
        return [json.loads(r["summary_json"]) for r in rows]
    finally:
        conn.close()


def save_midrace_snapshot(base_dir: Path, save_id: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    conn = _connect(base_dir)
    try:
        now = time.time()
        conn.execute(
            """
            INSERT INTO ladder_midrace (
                save_id, season, round, tier, circuit_id, lap, total_laps, updated_at, snapshot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(save_id) DO UPDATE SET
                season=excluded.season,
                round=excluded.round,
                tier=excluded.tier,
                circuit_id=excluded.circuit_id,
                lap=excluded.lap,
                total_laps=excluded.total_laps,
                updated_at=excluded.updated_at,
                snapshot_json=excluded.snapshot_json
            """,
            (
                save_id,
                int(snapshot.get("season") or 1),
                int(snapshot.get("round") or 1),
                str(snapshot.get("tier") or "karting"),
                str(snapshot.get("circuit_id") or ""),
                int(snapshot.get("lap") or 1),
                int(snapshot.get("total_laps") or 15),
                now,
                json.dumps(snapshot),
            ),
        )
        conn.commit()
        return {"save_id": save_id, "lap": int(snapshot.get("lap") or 1), "updated_at": now}
    finally:
        conn.close()


def load_midrace_snapshot(base_dir: Path, save_id: str) -> dict[str, Any] | None:
    conn = _connect(base_dir)
    try:
        row = conn.execute(
            "SELECT season, round, tier, circuit_id, lap, total_laps, updated_at, snapshot_json FROM ladder_midrace WHERE save_id = ?",
            (save_id,),
        ).fetchone()
        if not row:
            return None
        out = dict(row)
        out["snapshot"] = json.loads(out.pop("snapshot_json"))
        return out
    finally:
        conn.close()


def delete_midrace_snapshot(base_dir: Path, save_id: str) -> bool:
    conn = _connect(base_dir)
    try:
        cur = conn.execute("DELETE FROM ladder_midrace WHERE save_id = ?", (save_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def archive_race_report(
    base_dir: Path,
    save_id: str,
    *,
    season: int,
    round_num: int,
    tier: str,
    circuit_id: str,
    winner_name: str,
    winner_team: str = "",
    weather_summary: str = "Dry",
    sc_count: int = 0,
    report: dict[str, Any] | None = None,
) -> int:
    conn = _connect(base_dir)
    try:
        now = time.time()
        cur = conn.execute(
            """
            INSERT INTO ladder_race_reports (
                save_id, season, round, tier, circuit_id, winner_name, winner_team,
                weather_summary, sc_count, report_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(save_id, season, round) DO UPDATE SET
                tier=excluded.tier,
                circuit_id=excluded.circuit_id,
                winner_name=excluded.winner_name,
                winner_team=excluded.winner_team,
                weather_summary=excluded.weather_summary,
                sc_count=excluded.sc_count,
                report_json=excluded.report_json,
                created_at=excluded.created_at
            """,
            (
                save_id,
                int(season),
                int(round_num),
                str(tier),
                str(circuit_id),
                str(winner_name or ""),
                str(winner_team or ""),
                str(weather_summary or "Dry"),
                int(sc_count or 0),
                json.dumps(report or {}),
                now,
            ),
        )
        conn.commit()
        return int(cur.lastrowid or 0)
    finally:
        conn.close()


def list_race_reports(base_dir: Path, save_id: str, limit: int = 50) -> list[dict[str, Any]]:
    conn = _connect(base_dir)
    try:
        rows = conn.execute(
            """
            SELECT report_id, save_id, season, round, tier, circuit_id,
                   winner_name, winner_team, weather_summary, sc_count, report_json, created_at
            FROM ladder_race_reports
            WHERE save_id = ?
            ORDER BY season DESC, round DESC
            LIMIT ?
            """,
            (save_id, int(limit)),
        ).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["report"] = json.loads(d.pop("report_json") or "{}")
            out.append(d)
        return out
    finally:
        conn.close()


def check_ladder_integrity(base_dir: Path) -> dict[str, Any]:
    """Verify ladder_saves.sqlite WAL mode and required relational tables."""
    required = ("ladder_saves", "ladder_history", "ladder_midrace", "ladder_race_reports")
    conn = _connect(base_dir)
    try:
        jm = str(conn.execute("PRAGMA journal_mode").fetchone()[0]).lower()
        existing = {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        missing = [t for t in required if t not in existing]
        counts = {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in required if t in existing}
        return {
            "ok": (jm == "wal" and not missing),
            "journal_mode": jm,
            "required_tables": list(required),
            "missing_tables": missing,
            "row_counts": counts,
        }
    finally:
        conn.close()


def commit_season_transition(
    base_dir: Path,
    save_id: str,
    state: dict[str, Any],
    history_record: dict[str, Any] | None = None,
) -> str:
    """Atomically commit season-end world transitions (ladder_saves + ladder_history) in ONE WAL transaction."""
    conn = _connect(base_dir)
    try:
        now = time.time()
        sid = str(save_id or state.get("save_id") or uuid.uuid4().hex[:12])
        state["save_id"] = sid
        state["updated_at"] = now
        if not state.get("created_at"):
            state["created_at"] = now
        player = state.get("player", {})
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO ladder_saves (
                save_id, team_name, principal_name, tier, season, round,
                cash_k, reputation, career_path, state_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(save_id) DO UPDATE SET
                team_name=excluded.team_name,
                principal_name=excluded.principal_name,
                tier=excluded.tier,
                season=excluded.season,
                round=excluded.round,
                cash_k=excluded.cash_k,
                reputation=excluded.reputation,
                career_path=excluded.career_path,
                state_json=excluded.state_json,
                updated_at=excluded.updated_at
            """,
            (
                sid,
                str(player.get("team_name") or "Apex Motorsport"),
                str(player.get("principal_name") or "Team Principal"),
                str(state.get("tier") or "karting"),
                int(state.get("season") or 1),
                int(state.get("round") or 1),
                float(state.get("economy", {}).get("cash_k") or 0.0),
                float(player.get("reputation") or 10.0),
                str(player.get("career_path") or "owner_ladder"),
                json.dumps(state),
                float(state["created_at"]),
                now,
            ),
        )
        if history_record:
            conn.execute(
                """
                INSERT INTO ladder_history (
                    save_id, season, tier, team_name, team_pos, champion_driver,
                    points, career_path, summary_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sid,
                    int(history_record.get("season") or 1),
                    str(history_record.get("tier") or "karting"),
                    str(history_record.get("team_name") or ""),
                    int(history_record.get("team_pos") or 1),
                    str(history_record.get("champion_driver") or ""),
                    float(history_record.get("points") or 0.0),
                    str(history_record.get("career_path") or "owner_ladder"),
                    json.dumps(history_record),
                    now,
                ),
            )
        conn.commit()
        return sid
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def delete_save(base_dir: Path, save_id: str) -> bool:
    conn = _connect(base_dir)
    try:
        cur = conn.execute("DELETE FROM ladder_saves WHERE save_id = ?", (save_id,))
        conn.execute("DELETE FROM ladder_history WHERE save_id = ?", (save_id,))
        conn.execute("DELETE FROM ladder_midrace WHERE save_id = ?", (save_id,))
        conn.execute("DELETE FROM ladder_race_reports WHERE save_id = ?", (save_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()
