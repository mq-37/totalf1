from __future__ import annotations

import sqlite3
from dataclasses import asdict
import json
import hashlib
from pathlib import Path
from typing import Iterable, List, Tuple, Optional
import re

from .scraper import RaceRow, DriverStandingRow, TeamStandingRow, FastestLapRow


class Database:
    def __init__(self, db_path: str | Path, *, init_schema: bool = True) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        if init_schema:
            self._conn.execute("PRAGMA journal_mode = WAL")
            self._create_schema()
            self._migrate_points_to_real_if_needed()

    def __enter__(self) -> "Database":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _create_schema(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS races (
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                grand_prix TEXT NOT NULL,
                date TEXT NOT NULL,
                winner TEXT NOT NULL,
                team TEXT NOT NULL,
                laps INTEGER,
                time TEXT,
                race_url TEXT NOT NULL,
                PRIMARY KEY (year, round)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drivers_standings (
                year INTEGER NOT NULL,
                position INTEGER NOT NULL,
                driver TEXT NOT NULL,
                nationality TEXT NOT NULL,
                team TEXT NOT NULL,
                points INTEGER NOT NULL,
                driver_id TEXT,
                driver_url TEXT NOT NULL,
                PRIMARY KEY (year, position)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS team_standings (
                year INTEGER NOT NULL,
                position INTEGER NOT NULL,
                team TEXT NOT NULL,
                points INTEGER NOT NULL,
                team_id TEXT,
                team_url TEXT NOT NULL,
                PRIMARY KEY (year, position)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS fastest_laps (
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                grand_prix TEXT NOT NULL,
                winner TEXT NOT NULL,
                time TEXT NOT NULL,
                race_url TEXT NOT NULL,
                PRIMARY KEY (year, round)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS race_results (
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                driver TEXT NOT NULL,
                team TEXT NOT NULL,
                position_text TEXT,
                position_order INTEGER NOT NULL,
                PRIMARY KEY (year, round, driver)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS driver_avatars (
                driver TEXT PRIMARY KEY,
                avatar_json TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS driver_images (
                driver TEXT PRIMARY KEY,
                image_path TEXT NOT NULL
            )
            """
        )
        # Secondary indexes for fast profile, analytics, card, and team-color queries
        for idx_sql in (
            "CREATE INDEX IF NOT EXISTS idx_ds_driver ON drivers_standings(driver)",
            "CREATE INDEX IF NOT EXISTS idx_ds_team ON drivers_standings(team)",
            "CREATE INDEX IF NOT EXISTS idx_ds_pos_year ON drivers_standings(position, year)",
            "CREATE INDEX IF NOT EXISTS idx_ts_team ON team_standings(team)",
            "CREATE INDEX IF NOT EXISTS idx_races_winner ON races(winner)",
            "CREATE INDEX IF NOT EXISTS idx_races_team ON races(team)",
            "CREATE INDEX IF NOT EXISTS idx_rr_driver ON race_results(driver)",
            "CREATE INDEX IF NOT EXISTS idx_fl_winner ON fastest_laps(winner)",
        ):
            self._conn.execute(idx_sql)
        self._conn.commit()

    def _migrate_points_to_real_if_needed(self) -> None:
        """Convert drivers_standings and team_standings points from INTEGER to REAL.
        Fixes half-points stored as 10x (e.g. 395.5 stored as 3955) by dividing when
        value >= 1000 and ends in 5 (likely .5)."""
        for table, pk in [("drivers_standings", "year, position"), ("team_standings", "year, position")]:
            cur = self._conn.execute(f"PRAGMA table_info({table})")
            cols = {row[1]: row[2].upper() for row in cur.fetchall()}
            if cols.get("points", "").upper() != "INTEGER":
                continue
            new_table = f"{table}_new"
            # Create new table with points REAL; other columns match
            self._conn.execute(
                f"""
                CREATE TABLE {new_table} (
                    year INTEGER NOT NULL,
                    position INTEGER NOT NULL,
                    driver TEXT NOT NULL,
                    nationality TEXT NOT NULL,
                    team TEXT NOT NULL,
                    points REAL NOT NULL,
                    driver_id TEXT,
                    driver_url TEXT NOT NULL,
                    PRIMARY KEY (year, position)
                )
                """
                if table == "drivers_standings"
                else
                f"""
                CREATE TABLE {new_table} (
                    year INTEGER NOT NULL,
                    position INTEGER NOT NULL,
                    team TEXT NOT NULL,
                    points REAL NOT NULL,
                    team_id TEXT,
                    team_url TEXT NOT NULL,
                    PRIMARY KEY (year, position)
                )
                """
            )
            # Copy with conversion: half-points stored as X5 (e.g. 3955) -> X.5 (395.5)
            if table == "drivers_standings":
                self._conn.execute(
                    """
                    INSERT INTO drivers_standings_new
                    SELECT year, position, driver, nationality, team,
                        CASE WHEN points >= 1000 AND points % 10 = 5 THEN points / 10.0 ELSE CAST(points AS REAL) END,
                        driver_id, driver_url
                    FROM drivers_standings
                    """
                )
            else:
                self._conn.execute(
                    """
                    INSERT INTO team_standings_new
                    SELECT year, position, team,
                        CASE WHEN points >= 1000 AND points % 10 = 5 THEN points / 10.0 ELSE CAST(points AS REAL) END,
                        team_id, team_url
                    FROM team_standings
                    """
                )
            self._conn.execute(f"DROP TABLE {table}")
            self._conn.execute(f"ALTER TABLE {new_table} RENAME TO {table}")
        self._conn.commit()

    # ---------------------- Normalized schema ----------------------
    def _create_normalized_schema(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS seasons (
                year INTEGER PRIMARY KEY
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS drivers (
                driver_id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS teams (
                team_id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS grands_prix (
                gp_slug TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS races_normalized (
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                race_id INTEGER,
                gp_slug TEXT NOT NULL,
                date TEXT,
                winner_name TEXT,
                team_name TEXT,
                laps INTEGER,
                time TEXT,
                race_url TEXT NOT NULL,
                PRIMARY KEY (year, round),
                FOREIGN KEY (year) REFERENCES seasons(year) ON DELETE CASCADE,
                FOREIGN KEY (gp_slug) REFERENCES grands_prix(gp_slug) ON DELETE RESTRICT
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS driver_standings_normalized (
                year INTEGER NOT NULL,
                position INTEGER NOT NULL,
                driver_id TEXT,
                team_id TEXT,
                points REAL NOT NULL,
                PRIMARY KEY (year, position),
                FOREIGN KEY (year) REFERENCES seasons(year) ON DELETE CASCADE,
                FOREIGN KEY (driver_id) REFERENCES drivers(driver_id) ON DELETE SET NULL,
                FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE SET NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS team_standings_normalized (
                year INTEGER NOT NULL,
                position INTEGER NOT NULL,
                team_id TEXT,
                points REAL NOT NULL,
                PRIMARY KEY (year, position),
                FOREIGN KEY (year) REFERENCES seasons(year) ON DELETE CASCADE,
                FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE SET NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS fastest_laps_normalized (
                year INTEGER NOT NULL,
                round INTEGER NOT NULL,
                race_id INTEGER,
                gp_slug TEXT NOT NULL,
                winner_name TEXT NOT NULL,
                time TEXT NOT NULL,
                race_url TEXT NOT NULL,
                PRIMARY KEY (year, round),
                FOREIGN KEY (year) REFERENCES seasons(year) ON DELETE CASCADE,
                FOREIGN KEY (gp_slug) REFERENCES grands_prix(gp_slug) ON DELETE RESTRICT
            )
            """
        )
        self._conn.commit()

    @staticmethod
    def _extract_race_id_and_slug(race_url: str) -> Tuple[int | None, str | None]:
        # Expected: .../races/<id>/<slug>/race-result
        m = re.search(r"/races/(\d+)/(.*?)/", race_url)
        if not m:
            return None, None
        race_id = int(m.group(1))
        slug = m.group(2)
        return race_id, slug

    def normalize(self) -> dict:
        self._create_normalized_schema()

        # Seasons from union of existing tables
        self._conn.execute(
            "INSERT OR IGNORE INTO seasons(year) SELECT DISTINCT year FROM races"
        )
        self._conn.execute(
            "INSERT OR IGNORE INTO seasons(year) SELECT DISTINCT year FROM drivers_standings"
        )
        self._conn.execute(
            "INSERT OR IGNORE INTO seasons(year) SELECT DISTINCT year FROM team_standings"
        )
        self._conn.execute(
            "INSERT OR IGNORE INTO seasons(year) SELECT DISTINCT year FROM fastest_laps"
        )

        # Drivers
        self._conn.execute(
            """
            INSERT OR IGNORE INTO drivers(driver_id, name)
            SELECT DISTINCT driver_id, driver
            FROM drivers_standings
            WHERE driver_id IS NOT NULL AND driver_id != ''
            """
        )
        # Teams
        self._conn.execute(
            """
            INSERT OR IGNORE INTO teams(team_id, name)
            SELECT DISTINCT team_id, team
            FROM team_standings
            WHERE team_id IS NOT NULL AND team_id != ''
            """
        )

        # Grands Prix from races URLs
        cur = self._conn.execute(
            "SELECT DISTINCT grand_prix, race_url FROM races"
        )
        gp_rows = cur.fetchall()
        for row in gp_rows:
            _, slug = self._extract_race_id_and_slug(row["race_url"])
            if not slug:
                continue
            self._conn.execute(
                "INSERT OR IGNORE INTO grands_prix(gp_slug, name) VALUES (?, ?)",
                (slug, row["grand_prix"]),
            )

        # races_normalized
        cur = self._conn.execute(
            "SELECT year, round, grand_prix, date, winner, team, laps, time, race_url FROM races"
        )
        for r in cur.fetchall():
            race_id, slug = self._extract_race_id_and_slug(r["race_url"])
            if not slug:
                slug = re.sub(r"[^a-z0-9-]", "-", r["grand_prix"].lower())
            self._conn.execute(
                """
                INSERT INTO races_normalized (year, round, race_id, gp_slug, date, winner_name, team_name, laps, time, race_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(year, round) DO UPDATE SET
                  race_id=excluded.race_id,
                  gp_slug=excluded.gp_slug,
                  date=excluded.date,
                  winner_name=excluded.winner_name,
                  team_name=excluded.team_name,
                  laps=excluded.laps,
                  time=excluded.time,
                  race_url=excluded.race_url
                """,
                (
                    r["year"],
                    r["round"],
                    race_id,
                    slug,
                    r["date"],
                    r["winner"],
                    r["team"],
                    r["laps"],
                    r["time"],
                    r["race_url"],
                ),
            )

        # driver_standings_normalized
        self._conn.execute(
            "DELETE FROM driver_standings_normalized"
        )
        self._conn.execute(
            """
            INSERT INTO driver_standings_normalized(year, position, driver_id, team_id, points)
            SELECT ds.year, ds.position, ds.driver_id, ts.team_id, ds.points
            FROM drivers_standings ds
            LEFT JOIN team_standings ts
              ON ts.year = ds.year AND ts.team = ds.team
            """
        )

        # team_standings_normalized
        self._conn.execute(
            "DELETE FROM team_standings_normalized"
        )
        self._conn.execute(
            """
            INSERT INTO team_standings_normalized(year, position, team_id, points)
            SELECT year, position, team_id, points
            FROM team_standings
            """
        )

        # fastest_laps_normalized
        cur = self._conn.execute(
            "SELECT year, round, grand_prix, winner, time, race_url FROM fastest_laps"
        )
        for r in cur.fetchall():
            race_id, slug = self._extract_race_id_and_slug(r["race_url"])
            if not slug:
                slug = re.sub(r"[^a-z0-9-]", "-", r["grand_prix"].lower())
            self._conn.execute(
                """
                INSERT INTO fastest_laps_normalized(year, round, race_id, gp_slug, winner_name, time, race_url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(year, round) DO UPDATE SET
                  race_id=excluded.race_id,
                  gp_slug=excluded.gp_slug,
                  winner_name=excluded.winner_name,
                  time=excluded.time,
                  race_url=excluded.race_url
                """,
                (
                    r["year"],
                    r["round"],
                    race_id,
                    slug,
                    r["winner"],
                    r["time"],
                    r["race_url"],
                ),
            )

        self._conn.commit()

        # stats
        stats = {}
        for table in (
            "seasons",
            "drivers",
            "teams",
            "grands_prix",
            "races_normalized",
            "driver_standings_normalized",
            "team_standings_normalized",
            "fastest_laps_normalized",
        ):
            cur = self._conn.execute(f"SELECT COUNT(1) AS c FROM {table}")
            stats[table] = cur.fetchone()["c"]
        return stats

    # ---------------------- Avatars ----------------------
    @staticmethod
    def _seed_from_name(name: str) -> bytes:
        return hashlib.sha256(name.encode("utf-8")).digest()

    @staticmethod
    def _color_from_seed(seed: bytes, offset: int) -> str:
        # Derive a pastel-ish color from seed bytes and offset
        b0 = seed[(0 + offset) % len(seed)]
        b1 = seed[(7 + offset) % len(seed)]
        b2 = seed[(13 + offset) % len(seed)]
        # Pastel mix towards 200..255
        r = (b0 // 2) + 128
        g = (b1 // 2) + 128
        b = (b2 // 2) + 128
        return f"#{r:02x}{g:02x}{b:02x}"

    def get_avatar(self, driver_name: str) -> dict | None:
        cur = self._conn.execute(
            "SELECT avatar_json FROM driver_avatars WHERE driver=?",
            (driver_name,),
        )
        row = cur.fetchone()
        if not row:
            return None
        try:
            return json.loads(row["avatar_json"]) or {}
        except Exception:
            return {}

    @staticmethod
    def avatar_from_team_colors(team_colors: dict | None = None) -> dict:
        """Default race-suit colours from team livery (primary/secondary/accent)."""
        tc = team_colors or {}
        primary = tc.get("primary") or "#555555"
        secondary = tc.get("secondary") or "#dddddd"
        accent = tc.get("accent") or "#111111"
        return {
            "suit": primary,
            "helmet": secondary,
            "accent": accent,
            "trim": accent,
            "custom": False,
            "style": "race",
        }

    def resolve_avatar(self, driver_name: str, team_colors: dict | None = None) -> dict:
        """Effective avatar: driver custom override if set, else team-colour defaults.

        A stored avatar only wins when ``custom`` is true (explicit save). Older
        seed-generated rows without ``custom`` fall back to team colours.
        """
        stored = self.get_avatar(driver_name)
        base = self.avatar_from_team_colors(team_colors)
        if stored and stored.get("custom"):
            out = {**base, **stored, "custom": True}
            if not out.get("trim"):
                out["trim"] = out.get("accent") or base["trim"]
            return out
        return base

    def get_or_create_avatar(self, driver_name: str) -> dict:
        """Backward-compatible: return custom avatar or team-neutral defaults (no auto-seed)."""
        return self.resolve_avatar(driver_name, None)

    def upsert_avatar(self, driver_name: str, avatar: dict) -> None:
        payload = json.dumps(avatar, ensure_ascii=False)
        self._conn.execute(
            "INSERT INTO driver_avatars(driver, avatar_json) VALUES (?, ?)\n"
            "ON CONFLICT(driver) DO UPDATE SET avatar_json=excluded.avatar_json",
            (driver_name, payload),
        )
        self._conn.commit()

    def clear_avatar(self, driver_name: str) -> None:
        """Remove driver colour override so team defaults apply again."""
        self._conn.execute("DELETE FROM driver_avatars WHERE driver=?", (driver_name,))
        self._conn.commit()

    # ---------------------- Driver Images ----------------------
    def get_driver_image(self, driver_name: str) -> str | None:
        cur = self._conn.execute(
            "SELECT image_path FROM driver_images WHERE driver=?",
            (driver_name,),
        )
        row = cur.fetchone()
        return row["image_path"] if row else None

    def upsert_driver_image(self, driver_name: str, image_path: str) -> None:
        self._conn.execute(
            "INSERT INTO driver_images(driver, image_path) VALUES (?, ?)\n"
            "ON CONFLICT(driver) DO UPDATE SET image_path=excluded.image_path",
            (driver_name, image_path),
        )
        self._conn.commit()

    # ---------------------- Denormalized upserts/list ----------------------
    def upsert_races(self, races: Iterable[RaceRow]) -> int:
        sql = (
            "INSERT INTO races (year, round, grand_prix, date, winner, team, laps, time, race_url) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(year, round) DO UPDATE SET "
            "grand_prix=excluded.grand_prix, date=excluded.date, winner=excluded.winner, "
            "team=excluded.team, laps=excluded.laps, time=excluded.time, race_url=excluded.race_url"
        )
        data = [
            (
                r.year,
                r.round_number,
                r.grand_prix,
                r.date,
                r.winner,
                r.team,
                r.laps,
                r.time,
                r.race_url,
            )
            for r in races
        ]
        cur = self._conn.executemany(sql, data)
        self._conn.commit()
        return cur.rowcount or 0

    def list_races(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            "SELECT year, round, grand_prix, date, winner, team, laps, time FROM races WHERE year=? ORDER BY round",
            (year,),
        )
        return list(cur.fetchall())

    def upsert_driver_standings(self, rows: Iterable[DriverStandingRow]) -> int:
        sql = (
            "INSERT INTO drivers_standings (year, position, driver, nationality, team, points, driver_id, driver_url) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(year, position) DO UPDATE SET "
            "driver=excluded.driver, nationality=excluded.nationality, team=excluded.team, "
            "points=excluded.points, driver_id=excluded.driver_id, driver_url=excluded.driver_url"
        )
        data = [
            (
                r.year,
                r.position,
                r.driver,
                r.nationality,
                r.team,
                r.points,
                r.driver_id,
                r.driver_url,
            )
            for r in rows
        ]
        cur = self._conn.executemany(sql, data)
        self._conn.commit()
        return cur.rowcount or 0

    def list_driver_standings(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            "SELECT year, position, driver, nationality, team, points FROM drivers_standings WHERE year=? ORDER BY position",
            (year,),
        )
        return list(cur.fetchall())

    def upsert_team_standings(self, rows: Iterable[TeamStandingRow]) -> int:
        sql = (
            "INSERT INTO team_standings (year, position, team, points, team_id, team_url) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(year, position) DO UPDATE SET "
            "team=excluded.team, points=excluded.points, team_id=excluded.team_id, team_url=excluded.team_url"
        )
        data = [
            (
                r.year,
                r.position,
                r.team,
                r.points,
                r.team_id,
                r.team_url,
            )
            for r in rows
        ]
        cur = self._conn.executemany(sql, data)
        self._conn.commit()
        return cur.rowcount or 0

    def list_team_standings(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            "SELECT year, position, team, points FROM team_standings WHERE year=? ORDER BY position",
            (year,),
        )
        return list(cur.fetchall())

    def upsert_fastest_laps(self, rows: Iterable[FastestLapRow]) -> int:
        sql = (
            "INSERT INTO fastest_laps (year, round, grand_prix, winner, time, race_url) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(year, round) DO UPDATE SET "
            "grand_prix=excluded.grand_prix, winner=excluded.winner, time=excluded.time, race_url=excluded.race_url"
        )
        data = [
            (
                r.year,
                r.round_number,
                r.grand_prix,
                r.winner,
                r.time,
                r.race_url,
            )
            for r in rows
        ]
        cur = self._conn.executemany(sql, data)
        self._conn.commit()
        return cur.rowcount or 0

    def list_fastest_laps(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            "SELECT year, round, grand_prix, winner, time FROM fastest_laps WHERE year=? ORDER BY round",
            (year,),
        )
        return list(cur.fetchall())

    # ---------------------- Race results (per-race classification) ----------------------
    def upsert_race_results(self, rows: Iterable[dict]) -> int:
        sql = (
            "INSERT INTO race_results (year, round, driver, team, position_text, position_order) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(year, round, driver) DO UPDATE SET "
            "team=excluded.team, position_text=excluded.position_text, position_order=excluded.position_order"
        )
        data = [
            (
                r["year"],
                r["round_number"],
                r["driver"],
                r["team"],
                r.get("position_text"),
                int(r.get("position_order", 0)),
            )
            for r in rows
        ]
        cur = self._conn.executemany(sql, data)
        self._conn.commit()
        return cur.rowcount or 0

    # ---------------------- Analytics ----------------------
    def driver_total_points(self, driver_name_like: str | None = None) -> List[sqlite3.Row]:
        if driver_name_like:
            cur = self._conn.execute(
                """
                SELECT driver AS driver_name, SUM(points) AS total_points, COUNT(*) AS seasons_count
                FROM drivers_standings
                WHERE driver LIKE ?
                GROUP BY driver
                ORDER BY total_points DESC
                """,
                (f"%{driver_name_like}%",),
            )
        else:
            cur = self._conn.execute(
                """
                SELECT driver AS driver_name, SUM(points) AS total_points, COUNT(*) AS seasons_count
                FROM drivers_standings
                GROUP BY driver
                ORDER BY total_points DESC
                """
            )
        return list(cur.fetchall())

    def driver_champions(self) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT year, position, driver AS driver_name, team, points
            FROM drivers_standings
            WHERE position = 1
            ORDER BY year
            """
        )
        return list(cur.fetchall())

    def constructor_champions(self) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT year, position, team, points
            FROM team_standings
            WHERE position = 1
            ORDER BY year
            """
        )
        return list(cur.fetchall())

    def driver_wins_by_year(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT winner AS driver_name, COUNT(*) AS wins
            FROM races
            WHERE year = ?
            GROUP BY winner
            ORDER BY wins DESC, driver_name
            """,
            (year,),
        )
        return list(cur.fetchall())

    def team_wins_by_year(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT team, COUNT(*) AS wins
            FROM races
            WHERE year = ?
            GROUP BY team
            ORDER BY wins DESC, team
            """,
            (year,),
        )
        return list(cur.fetchall())

    def fastest_lap_leaders_by_year(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT winner AS driver_name, COUNT(*) AS fastest_laps
            FROM fastest_laps
            WHERE year = ?
            GROUP BY winner
            ORDER BY fastest_laps DESC, driver_name
            """,
            (year,),
        )
        return list(cur.fetchall())

    def points_by_team_year(self, year: int) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT team, SUM(points) AS total_points
            FROM drivers_standings
            WHERE year = ?
            GROUP BY team
            ORDER BY total_points DESC
            """,
            (year,),
        )
        return list(cur.fetchall())

    def team_total_points_overall(self) -> List[sqlite3.Row]:
        cur = self._conn.execute(
            """
            SELECT team, SUM(points) AS total_points, COUNT(DISTINCT year) AS seasons
            FROM drivers_standings
            GROUP BY team
            ORDER BY total_points DESC
            """
        )
        return list(cur.fetchall())

    # ---------------------- Per-track championship ----------------------
    # Normalised points per position at a track: 1st=10, 2nd=9, ..., 10th=1. Positions >10 = 0.
    def per_track_driver_points(self, top_per_track: int = 1) -> List[dict]:
        """
        For each track (grand_prix), compute driver points using 1st=10, 2nd=9, ..., 10th=1.
        Returns rows with grand_prix, driver, points, races, rank (per track).
        top_per_track: return only the top N drivers per track (1 = champion only).
        """
        cur = self._conn.execute(
            """
            WITH track_driver_points AS (
                SELECT r.grand_prix, rr.driver,
                    SUM(CASE WHEN rr.position_order BETWEEN 1 AND 10 THEN (11 - rr.position_order) ELSE 0 END) AS points,
                    COUNT(*) AS races
                FROM race_results rr
                JOIN races r ON rr.year = r.year AND rr.round = r.round
                GROUP BY r.grand_prix, rr.driver
            ),
            ranked AS (
                SELECT grand_prix, driver, points, races,
                    RANK() OVER (PARTITION BY grand_prix ORDER BY points DESC) AS rk
                FROM track_driver_points
            )
            SELECT grand_prix, driver, points, races, rk AS rank
            FROM ranked
            WHERE rk <= ?
            ORDER BY grand_prix, rank
            """,
            (max(1, int(top_per_track)),),
        )
        return [dict(row) for row in cur.fetchall()]

    def per_track_standings(self, grand_prix: str, limit: int = 20) -> List[dict]:
        """Standings at a single track (normalised points 1st=10 .. 10th=1)."""
        cur = self._conn.execute(
            """
            SELECT rr.driver,
                SUM(CASE WHEN rr.position_order BETWEEN 1 AND 10 THEN (11 - rr.position_order) ELSE 0 END) AS points,
                COUNT(*) AS races
            FROM race_results rr
            JOIN races r ON rr.year = r.year AND rr.round = r.round
            WHERE r.grand_prix = ?
            GROUP BY rr.driver
            ORDER BY points DESC
            LIMIT ?
            """,
            (grand_prix, limit),
        )
        rows = [dict(r) for r in cur.fetchall()]
        for i, r in enumerate(rows, 1):
            r["rank"] = i
        return rows

    def list_tracks(self) -> List[str]:
        """Distinct grand prix names (tracks) for dropdowns."""
        cur = self._conn.execute(
            "SELECT DISTINCT grand_prix FROM races ORDER BY grand_prix"
        )
        return [row["grand_prix"] for row in cur.fetchall()]

    # ---------------------- Slug resolution ----------------------
    def resolve_driver_name(self, slug_or_name: str) -> str:
        """Resolve a URL slug (e.g. 'Jean-Pierre-Beltoise-BEL') to the exact DB driver name.

        Handles names containing literal hyphens where naive replace('-', ' ') breaks lookups.
        """
        raw = (slug_or_name or "").strip()
        if not raw:
            return raw
        spaced = raw.replace("-", " ")
        # 1. Exact match on raw or spaced form
        for candidate in (raw, spaced):
            row = self._conn.execute(
                "SELECT driver FROM drivers_standings WHERE driver = ? LIMIT 1",
                (candidate,),
            ).fetchone()
            if row:
                return row["driver"]
        # 2. Case-insensitive match treating hyphens and spaces equivalently
        norm = spaced.lower()
        row = self._conn.execute(
            """
            SELECT driver FROM drivers_standings
            WHERE LOWER(REPLACE(driver, '-', ' ')) = ?
            ORDER BY year DESC LIMIT 1
            """,
            (norm,),
        ).fetchone()
        if row:
            return row["driver"]
        # 3. Also check race_results / races in case driver never scored standings
        for table, col in (("race_results", "driver"), ("races", "winner")):
            row = self._conn.execute(
                f"SELECT {col} AS name FROM {table} WHERE LOWER(REPLACE({col}, '-', ' ')) = ? LIMIT 1",
                (norm,),
            ).fetchone()
            if row:
                return row["name"]
        return spaced

    def resolve_team_name(self, slug_or_name: str) -> str:
        """Resolve a URL slug (e.g. 'Mercedes-Benz') to the exact DB team name."""
        raw = (slug_or_name or "").strip()
        if not raw:
            return raw
        spaced = raw.replace("-", " ")
        for candidate in (raw, spaced):
            for table in ("drivers_standings", "team_standings"):
                row = self._conn.execute(
                    f"SELECT team FROM {table} WHERE team = ? LIMIT 1",
                    (candidate,),
                ).fetchone()
                if row:
                    return row["team"]
        norm = spaced.lower()
        for table in ("drivers_standings", "team_standings"):
            row = self._conn.execute(
                f"""
                SELECT team FROM {table}
                WHERE LOWER(REPLACE(team, '-', ' ')) = ?
                ORDER BY year DESC LIMIT 1
                """,
                (norm,),
            ).fetchone()
            if row:
                return row["team"]
        return spaced

    # ---------------------- Team Detail ----------------------
    def team_profile(self, team_name: str) -> dict:
        name = self.resolve_team_name(team_name)

        # Per-season points
        cur = self._conn.execute(
            """
            SELECT year, SUM(points) AS points
            FROM drivers_standings
            WHERE team LIKE ?
            GROUP BY year
            ORDER BY year
            """,
            (f"%{name}%",),
        )
        points_by_year = [dict(r) for r in cur.fetchall()]

        # Total points and seasons active
        cur = self._conn.execute(
            """
            SELECT SUM(points) AS total_points, COUNT(DISTINCT year) AS seasons
            FROM drivers_standings
            WHERE team LIKE ?
            """,
            (f"%{name}%",),
        )
        totals = dict(cur.fetchone())

        # Wins by year from races
        cur = self._conn.execute(
            """
            SELECT year, COUNT(*) AS wins
            FROM races
            WHERE team LIKE ?
            GROUP BY year
            ORDER BY year
            """,
            (f"%{name}%",),
        )
        wins_by_year = [dict(r) for r in cur.fetchall()]
        total_wins = sum(r["wins"] for r in wins_by_year)

        # Active year span for this team (from its own history, not all seasons)
        active_years = [r["year"] for r in points_by_year] + [r["year"] for r in wins_by_year]
        if not active_years:
            cur = self._conn.execute(
                "SELECT MIN(year) AS first_year, MAX(year) AS last_year FROM team_standings WHERE team LIKE ?",
                (f"%{name}%",),
            )
            yr = cur.fetchone()
            first_year = yr["first_year"] if yr else None
            last_year = yr["last_year"] if yr else None
        else:
            first_year = min(active_years)
            last_year = max(active_years)

        # Constructor titles (position=1 in team_standings)
        cur = self._conn.execute(
            "SELECT COUNT(*) AS titles FROM team_standings WHERE position=1 AND team LIKE ?",
            (f"%{name}%",),
        )
        titles = cur.fetchone()["titles"]

        # Best driver finishes per season (position 1 entries)
        cur = self._conn.execute(
            """
            SELECT year, driver, points
            FROM drivers_standings
            WHERE team LIKE ? AND position=1
            ORDER BY year
            """,
            (f"%{name}%",),
        )
        champion_drivers = [dict(r) for r in cur.fetchall()]

        # Roster: drivers for this team (distinct)
        cur = self._conn.execute(
            """
            SELECT DISTINCT driver
            FROM drivers_standings
            WHERE team LIKE ?
            ORDER BY driver
            """,
            (f"%{name}%",),
        )
        drivers = [r["driver"] for r in cur.fetchall()]

        return {
            "team": name,
            "range": {"first_year": first_year, "last_year": last_year},
            "totals": {**totals, "wins": total_wins, "titles": titles},
            "points_by_year": points_by_year,
            "wins_by_year": wins_by_year,
            "champion_drivers": champion_drivers,
            "drivers": drivers,
        }

    # ---------------------- Driver Detail ----------------------
    def find_driver_id_by_name(self, name: str) -> Optional[str]:
        cur = self._conn.execute(
            "SELECT driver_id FROM drivers_standings WHERE driver LIKE ? AND driver_id IS NOT NULL ORDER BY year DESC LIMIT 1",
            (f"%{name}%",),
        )
        row = cur.fetchone()
        return row["driver_id"] if row else None

    def driver_profile(self, driver_id_or_name: str) -> dict:
        # Accept exact driver_id or fuzzy name
        driver_id = None
        if "/" not in driver_id_or_name and driver_id_or_name.upper() == driver_id_or_name and len(driver_id_or_name) >= 6:
            driver_id = driver_id_or_name
        else:
            driver_id = self.find_driver_id_by_name(driver_id_or_name) or None

        if driver_id:
            cur = self._conn.execute(
                "SELECT ? as driver_id, driver as name FROM drivers_standings WHERE driver_id=? ORDER BY year DESC LIMIT 1",
                (driver_id, driver_id),
            )
            r = cur.fetchone()
            name = r["name"] if r else driver_id_or_name
            name_like = name
        else:
            name = driver_id_or_name
            name_like = driver_id_or_name

        # Seasons summary
        cur = self._conn.execute(
            """
            SELECT year, position, team, points
            FROM drivers_standings
            WHERE driver LIKE ?
            ORDER BY year
            """,
            (f"%{name_like}%",),
        )
        seasons = [dict(r) for r in cur.fetchall()]

        # Career totals
        cur = self._conn.execute(
            "SELECT SUM(points) AS total_points, COUNT(*) AS seasons_count FROM drivers_standings WHERE driver LIKE ?",
            (f"%{name_like}%",),
        )
        totals = dict(cur.fetchone())

        # Wins from races table
        cur = self._conn.execute(
            "SELECT year, COUNT(*) AS wins FROM races WHERE winner LIKE ? GROUP BY year ORDER BY year",
            (f"%{name_like}%",),
        )
        wins_by_year = [dict(r) for r in cur.fetchall()]
        total_wins = sum(r["wins"] for r in wins_by_year)

        # Fastest laps
        cur = self._conn.execute(
            "SELECT year, COUNT(*) AS fastest FROM fastest_laps WHERE winner LIKE ? GROUP BY year ORDER BY year",
            (f"%{name_like}%",),
        )
        fl_by_year = [dict(r) for r in cur.fetchall()]
        total_fl = sum(r["fastest"] for r in fl_by_year)

        # Titles (position=1)
        cur = self._conn.execute(
            "SELECT COUNT(*) AS titles FROM drivers_standings WHERE position=1 AND driver LIKE ?",
            (f"%{name_like}%",),
        )
        titles = cur.fetchone()["titles"]

        # Career team win/loss (driver wins vs teammate wins across entire career)
        career_driver_wins, career_teammate_wins = self._overall_team_win_loss(name_like)

        # Season attributes and best overall
        season_attrs = self._driver_season_attributes(name_like)
        overall_best = None
        overall_best_year = None
        legacy_overall_best = None
        legacy_overall_best_year = None
        badge_counts: dict[str, int] = {}
        badge_years: dict[str, list[int]] = {}
        if season_attrs:
            best_entry = max(season_attrs, key=lambda x: x.get("overall", 0))
            overall_best = best_entry.get("overall")
            overall_best_year = best_entry.get("year")
            best_legacy_entry = max(season_attrs, key=lambda x: x.get("legacy_overall", 0))
            legacy_overall_best = best_legacy_entry.get("legacy_overall")
            legacy_overall_best_year = best_legacy_entry.get("year")
            for sa in season_attrs:
                for b in sa.get("badges", []):
                    badge_counts[b] = badge_counts.get(b, 0) + 1
                    badge_years.setdefault(b, []).append(sa.get("year"))

        # Champion years
        cur = self._conn.execute(
            "SELECT year FROM drivers_standings WHERE position=1 AND driver LIKE ? ORDER BY year",
            (f"%{name_like}%",),
        )
        champion_years = [r["year"] for r in cur.fetchall()]

        # Peaks: most wins / fastest laps in a season
        most_wins = None
        most_wins_year = None
        if wins_by_year:
            m = max(wins_by_year, key=lambda x: x["wins"]) if wins_by_year else None
            if m:
                most_wins = m["wins"]
                most_wins_year = m["year"]
        most_fastest = None
        most_fastest_year = None
        if fl_by_year:
            m2 = max(fl_by_year, key=lambda x: x["fastest"]) if fl_by_year else None
            if m2:
                most_fastest = m2["fastest"]
                most_fastest_year = m2["year"]

        legacy_detail = self._compute_driver_legacy_detail(name_like)

        first_year = seasons[0]["year"] if seasons else None
        last_year = seasons[-1]["year"] if seasons else None
        years_active = f"{first_year}–{last_year}" if first_year and last_year else "—"

        return {
            "driver_id": driver_id,
            "name": name,
            "years_active": years_active,
            "totals": {**totals, "wins": total_wins, "fastest_laps": total_fl, "titles": titles},
            "wins_by_year": wins_by_year,
            "fastest_by_year": fl_by_year,
            "seasons": seasons,
            "season_attributes": season_attrs,
            "team_wl_career": {"wins": career_driver_wins, "losses": career_teammate_wins},
            "overall_best": overall_best,
            "overall_best_year": overall_best_year,
            "legacy_overall_best": legacy_overall_best,
            "legacy_overall_best_year": legacy_overall_best_year,
            "accolades": {
                "champion_years": champion_years,
                "badge_counts": badge_counts,
                "badge_years": badge_years,
            },
            "peaks": {
                "most_wins": most_wins,
                "most_wins_year": most_wins_year,
                "most_fastest": most_fastest,
                "most_fastest_year": most_fastest_year,
            },
            "legacy_detail": legacy_detail,
        }

    def _driver_season_attributes(self, driver_name_like: str) -> list[dict]:
        cur = self._conn.execute(
            "SELECT DISTINCT year FROM drivers_standings WHERE driver LIKE ? ORDER BY year",
            (f"%{driver_name_like}%",),
        )
        years = [r["year"] for r in cur.fetchall()]
        out: list[dict] = []
        for y in years:
            # Use existing season ratings to compute attributes for this driver only
            ratings = self.driver_season_ratings(y)
            entry = next((r for r in ratings if r["driver"].lower() in driver_name_like.lower()), None)
            if entry:
                out.append({
                    "year": y,
                    "overall": entry["overall"],
                    "legacy_overall": entry.get("legacy_overall", entry["overall"] + entry.get("legacy_bonus", 0)),
                    "experience": entry["experience"],
                    "experience_seasons": entry.get("experience_seasons", 0),
                    "experience_bonus": entry.get("experience_bonus", 0.0),
                    "legacy_world_titles": entry["championships"],
                    "legacy_bonus": entry["legacy_bonus"],
                    "wins": entry["wins"],
                    "fastest_laps": entry["fastest_laps"],
                    "teammate_wins": entry.get("teammate_wins", 0),
                    "team_driver_wins": entry.get("team_driver_wins", 0),
                    "badges": entry.get("badges", []),
                })
        return out

    def search_drivers(self, q: str, limit: int = 25) -> list[dict]:
        cur = self._conn.execute(
            """
            SELECT driver AS name, MAX(year) AS last_year
            FROM drivers_standings
            WHERE driver LIKE ?
            GROUP BY driver
            ORDER BY last_year DESC
            LIMIT ?
            """,
            (f"%{q}%", limit),
        )
        return [dict(r) for r in cur.fetchall()]

    def get_driver_standing(self, year: int, position: int) -> Optional[sqlite3.Row]:
        cur = self._conn.execute(
            "SELECT year, position, driver, nationality, team, points, driver_id, driver_url FROM drivers_standings WHERE year=? AND position=?",
            (year, position),
        )
        return cur.fetchone()

    def update_driver_standing(self, year: int, position: int, *, driver: str, nationality: str, team: str, points: float, driver_id: str | None = None) -> int:
        cur = self._conn.execute(
            """
            UPDATE drivers_standings
            SET driver = ?, nationality = ?, team = ?, points = ?, driver_id = COALESCE(?, driver_id)
            WHERE year = ? AND position = ?
            """,
            (driver, nationality, team, points, driver_id, year, position),
        )
        self._conn.commit()
        return cur.rowcount or 0

    # ---------------------- Driver Cards / Ratings ----------------------
    def driver_season_ratings(self, year: int) -> List[dict]:
        """
        Compute simple ratings per driver for a given season.
        Metrics:
          - points_norm: points normalized to [0,100]
          - wins: number of wins that year
          - podiums: top-3 finishes (approximated from positions 1-3 in standings unavailable per race,
                     fallback to ranking by points only)
          - speed_index: proxy using wins + fastest laps weight
          - overall: weighted combination
        Note: We approximate with available tables (races, fastest_laps, drivers_standings).
        """
        # Base driver totals (points)
        cur = self._conn.execute(
            "SELECT driver, team, nationality, points, position FROM drivers_standings WHERE year=? ORDER BY points DESC",
            (year,),
        )
        rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            return []
        max_points = max(r["points"] for r in rows) or 1

        # Wins per driver
        cur = self._conn.execute(
            "SELECT winner AS driver, COUNT(*) AS wins FROM races WHERE year=? GROUP BY winner",
            (year,),
        )
        wins = {r["driver"]: r["wins"] for r in cur.fetchall()}

        # Fastest laps per driver
        cur = self._conn.execute(
            "SELECT winner AS driver, COUNT(*) AS fl FROM fastest_laps WHERE year=? GROUP BY winner",
            (year,),
        )
        fl = {r["driver"]: r["fl"] for r in cur.fetchall()}

        # Total number of races that year
        cur = self._conn.execute("SELECT COUNT(*) AS c FROM races WHERE year=?", (year,))
        total_races = int(cur.fetchone()["c"] or 0)

        # Modern (2025) points per driver for this season (per-race re-scoring)
        modern_points = self._compute_modern_points_for_year(year)
        # Fallback if no race_results data
        if not modern_points or sum(modern_points.values()) == 0:
            modern_points = self._compute_modern_points_proportional_for_year(year)
        max_modern_pts = max(modern_points.values()) if modern_points else 1

        # Years active (first–last) per driver for display
        cur = self._conn.execute(
            "SELECT driver, MIN(year) AS first_year, MAX(year) AS last_year FROM drivers_standings GROUP BY driver"
        )
        year_spans_season = {r["driver"]: (r["first_year"], r["last_year"]) for r in cur.fetchall()}

        # Pre-aggregate per-race teammate head-to-head & average classified finish from race_results
        cur = self._conn.execute(
            """
            SELECT driver,
                   AVG(CASE WHEN position_order > 0 THEN position_order END) AS avg_fin,
                   MIN(CASE WHEN position_order > 0 THEN position_order END) AS best_fin
            FROM race_results
            WHERE year=?
            GROUP BY driver
            """,
            (year,),
        )
        fin_stats = {
            r["driver"]: (
                float(r["avg_fin"]) if r["avg_fin"] is not None else None,
                int(r["best_fin"]) if r["best_fin"] is not None else None,
            )
            for r in cur.fetchall()
        }
        race_h2h = self._season_race_teammate_h2h(year)
        n_drivers = max(1, len(rows))
        max_w = max(wins.values()) if wins else 1
        max_f = max(fl.values()) if fl else 1

        ratings: List[dict] = []
        for idx_row, r in enumerate(rows):
            driver = r["driver"]
            first_yr, last_yr = year_spans_season.get(driver, (None, None))
            years_active_season = f"{first_yr}–{last_yr}" if first_yr and last_yr else (str(first_yr) if first_yr else "—")
            team = r["team"]
            nationality = r.get("nationality") or ""
            points = float(r["points"]) if r["points"] is not None else 0.0
            position_final = int(r.get("position") or (idx_row + 1))
            points_norm = round(points / max_points * 100.0, 2)
            w = int(wins.get(driver, 0))
            f = int(fl.get(driver, 0))
            speed_index = w * 3 + f * 1
            wins_norm = (w / max_w * 100.0) if max_w else 0.0
            fl_norm = (f / max_f * 100.0) if max_f else 0.0
            championships, legacy_bonus = self._compute_driver_legacy(driver)
            seasons_exp, exp_score = self._compute_driver_experience_score(driver, up_to_year=year)

            # Per-season team win/loss (standings + true race-by-race H2H)
            drv_w_season, tm_w_season = self._season_team_win_loss(year, driver)
            race_tm_w, race_tm_l = race_h2h.get(driver, (0, 0))
            dominance_index = round(0.5 * wins_norm + 0.5 * fl_norm, 2)
            tb_den = (race_tm_w + race_tm_l) if (race_tm_w + race_tm_l) > 0 else (drv_w_season + tm_w_season)
            tb_num = race_tm_w if (race_tm_w + race_tm_l) > 0 else drv_w_season
            teammate_battle_ratio = round(tb_num / tb_den, 3) if tb_den else None
            legacy_detail = self._compute_driver_legacy_detail(driver)

            # Modern points fields (2025 scheme without FL bonus)
            pts_modern = float(modern_points.get(driver, 0.0))
            pts_modern_norm = round(pts_modern / (max_modern_pts or 1) * 100.0, 2)

            # Fun/derived stats from race_results
            cur = self._conn.execute(
                "SELECT COUNT(DISTINCT round) AS c FROM race_results WHERE year=? AND driver=?",
                (year, driver),
            )
            starts = int(cur.fetchone()["c"] or 0)
            rate_den = starts or total_races
            win_rate = round((w / rate_den) * 100.0, 2) if rate_den else 0.0
            fl_rate = round((f / rate_den) * 100.0, 2) if rate_den else 0.0
            cur = self._conn.execute(
                "SELECT\n                   COUNT(DISTINCT CASE WHEN position_order BETWEEN 1 AND 3 THEN round END) AS podiums,\n                   COUNT(DISTINCT CASE WHEN position_order BETWEEN 1 AND 10 THEN round END) AS top10,\n                   COUNT(DISTINCT CASE WHEN position_order=0 THEN round END) AS dnfs\n                 FROM race_results WHERE year=? AND driver=?",
                (year, driver),
            )
            rowp = cur.fetchone() or {"podiums": 0, "top10": 0, "dnfs": 0}
            podiums = int(rowp["podiums"] or 0)
            top10 = int(rowp["top10"] or 0)
            dnfs = int(rowp["dnfs"] or 0)
            podium_rate = round((podiums / starts) * 100.0, 2) if starts else 0.0
            top10_rate = round((top10 / starts) * 100.0, 2) if starts else 0.0
            modern_pps = round((pts_modern / rate_den), 2) if rate_den else 0.0
            avg_finish, best_finish = fin_stats.get(driver, (None, None))
            if avg_finish is None:
                # Smooth rank-based fallback for early 1950s seasons lacking full classifications
                rank_frac = (position_final - 1) / max(1, n_drivers - 1)
                avg_finish = round(2.5 + rank_frac * 13.5, 2)
            else:
                avg_finish = round(avg_finish, 2)

            # Calibrated Season Overall (63–99 realistic F1 spread with Bayesian sample shrinkage!)
            # Eliminates P1-vs-P2 cliff & midfield pile-up at 65.0
            pps_score = min(100.0, ((max(0.0, modern_pps) / 21.0) ** 0.60) * 100.0)
            fin_score = max(0.0, min(100.0, (19.5 - avg_finish) / 17.5 * 100.0))
            win_score = 0.58 * min(100.0, ((max(0.0, win_rate) / 50.0) ** 0.55) * 100.0) + 0.42 * wins_norm
            fl_score = 0.50 * min(100.0, ((max(0.0, fl_rate) / 30.0) ** 0.55) * 100.0) + 0.50 * fl_norm
            h2h_score = ((race_tm_w + 2.5) / (race_tm_w + race_tm_l + 5.0)) * 100.0 if (race_tm_w + race_tm_l) > 0 else (62.0 if drv_w_season > tm_w_season else (44.0 if tm_w_season > drv_w_season else 50.0))
            raw_perf = (
                0.35 * pps_score
                + 0.25 * fin_score
                + 0.20 * win_score
                + 0.12 * h2h_score
                + 0.08 * fl_score
            )
            # Bayesian sample-size shrinkage: 1-race guest drivers regress toward prior 30.0
            sample_w = (starts / (starts + 3.5)) if starts > 0 else 0.78
            shrunk_perf = sample_w * raw_perf + (1.0 - sample_w) * 28.0
            overall = round(min(99.0, max(63.0, 62.5 + shrunk_perf * 0.365)), 2)
            legacy_overall = round(min(99.5, overall + legacy_bonus * 0.82 + seasons_exp * 0.08), 2)
            experience_bonus = round(seasons_exp * 0.10, 2)
            # Longest win streak
            cur = self._conn.execute(
                "SELECT round, position_order FROM race_results WHERE year=? AND driver=? ORDER BY round",
                (year, driver),
            )
            streak = 0
            best_streak = 0
            for rr in cur.fetchall():
                if int(rr["position_order"] or 0) == 1:
                    streak += 1
                    if streak > best_streak:
                        best_streak = streak
                else:
                    streak = 0
            win_streak = best_streak
            # Clutch wins (last third of season)
            clutch_wins = 0
            if total_races > 0:
                start_r = total_races - (total_races // 3) + 1
                cur = self._conn.execute(
                    "SELECT COUNT(*) AS c FROM race_results WHERE year=? AND driver=? AND position_order=1 AND round>=?",
                    (year, driver, start_r),
                )
                clutch_wins = int(cur.fetchone()["c"] or 0)

            # Badges (season)
            badges: List[str] = []
            if overall >= 100.0:
                badges.append("GOAT season")
            if total_races and (w >= total_races * 0.5):
                badges.append("Dominant")
            if position_final == 1:
                badges.append("Champion")
            if (w == max_w) and (f == max_f) and position_final == 1:
                badges.append("Triple crown")
            if tm_w_season == 0 and drv_w_season > 0:
                badges.append("Teammate sweep")
            if seasons_exp <= 2 and overall >= 85:
                badges.append("Rookie sensation")
            if total_races and (f >= total_races * 0.5):
                badges.append("Fastest-lap beast")
            # Career longevity
            if seasons_exp > 15:
                badges.append("Veteran")

            ratings.append({
                "driver": driver,
                "team": team,
                "nationality": nationality,
                "years_active": years_active_season,
                "points": points,
                "points_norm": points_norm,
                "points_modern": pts_modern,
                "points_modern_norm": pts_modern_norm,
                "wins": w,
                "fastest_laps": f,
                "speed_index": speed_index,
                "overall": overall,
                "legacy_overall": legacy_overall,
                "championships": championships,
                "legacy_bonus": legacy_bonus,
                "experience_bonus": experience_bonus,
                "experience": exp_score,
                "experience_seasons": seasons_exp,
                "teammate_wins": tm_w_season,
                "team_driver_wins": drv_w_season,
                "race_tm_wins": race_tm_w,
                "race_tm_losses": race_tm_l,
                "avg_finish": avg_finish,
                "best_finish": best_finish,
                # New performance metrics
                "win_rate": win_rate,                 # % of races won
                "fl_rate": fl_rate,                   # % of races with fastest lap
                "dominance_index": dominance_index,   # blend of wins/FL normalization
                # Fun stats
                "starts": starts,
                "podiums": podiums,
                "podium_rate": podium_rate,
                "top10": top10,
                "top10_rate": top10_rate,
                "dnfs": dnfs,
                "points_modern": pts_modern,
                "points_modern_norm": pts_modern_norm,
                "modern_pps": modern_pps,
                "win_streak": win_streak,
                "clutch_wins": clutch_wins,
                # Group legacy fields separately for display tie-breakers
                "legacy": {
                    "overall": legacy_overall,
                    "championships": championships,
                    "bonus": legacy_bonus,
                    "experience_bonus": experience_bonus,
                    "experience": exp_score,
                    "years": seasons_exp,
                    "detail": legacy_detail,
                },
                # Battle summaries
                "battles": {
                    "teammate": {
                        "wins": drv_w_season,
                        "losses": tm_w_season,
                        "ratio": teammate_battle_ratio,
                    },
                    "wins_vs_fl": {
                        "wins": w,
                        "fastest_laps": f,
                        "diff": w - f,
                    },
                    "points_share": round(points_norm / 100.0, 3),
                },
                "badges": badges,
            })

        # Sort by overall desc
        ratings.sort(key=lambda x: (-x["overall"], -x["points"]))
        # Add rank
        for i, r in enumerate(ratings, start=1):
            r["rank"] = i
        return ratings

    def driver_decade_ratings(self, decade_start: int) -> List[dict]:
        """
        Aggregate ratings across a decade window [decade_start, decade_start+9].
        Summarize per driver: total points, wins, fastest laps, seasons, and an overall rating.
        """
        start = decade_start
        end = decade_start + 9
        # Points per driver in decade
        cur = self._conn.execute(
            """
            SELECT driver, SUM(points) AS points, COUNT(DISTINCT year) AS seasons
            FROM drivers_standings
            WHERE year BETWEEN ? AND ?
            GROUP BY driver
            """,
            (start, end),
        )
        rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            return []
        max_points = max(r["points"] or 0 for r in rows) or 1

        # Modern points across decade window (per-race re-scoring)
        modern_points_dec = self._compute_modern_points_for_range(start, end)
        if not modern_points_dec or sum(modern_points_dec.values()) == 0:
            modern_points_dec = self._compute_modern_points_proportional_for_range(start, end)
        max_modern_dec = max(modern_points_dec.values()) if modern_points_dec else 1

        # Wins in decade
        cur = self._conn.execute(
            "SELECT winner AS driver, COUNT(*) AS wins FROM races WHERE year BETWEEN ? AND ? GROUP BY winner",
            (start, end),
        )
        wins = {r["driver"]: r["wins"] for r in cur.fetchall()}

        # Fastest laps in decade
        cur = self._conn.execute(
            "SELECT winner AS driver, COUNT(*) AS fl FROM fastest_laps WHERE year BETWEEN ? AND ? GROUP BY winner",
            (start, end),
        )
        fl = {r["driver"]: r["fl"] for r in cur.fetchall()}

        # A representative team (last team seen in decade)
        cur = self._conn.execute(
            """
            SELECT driver, team
            FROM (
              SELECT driver, team, year,
                     ROW_NUMBER() OVER (PARTITION BY driver ORDER BY year DESC) AS rn
              FROM drivers_standings
              WHERE year BETWEEN ? AND ?
            ) t WHERE rn=1
            """,
            (start, end),
        )
        last_team = {r["driver"]: r["team"] for r in cur.fetchall()}

        # Last nationality in decade
        cur = self._conn.execute(
            """
            SELECT driver, nationality
            FROM (
              SELECT driver, nationality, year,
                     ROW_NUMBER() OVER (PARTITION BY driver ORDER BY year DESC) AS rn
              FROM drivers_standings
              WHERE year BETWEEN ? AND ?
            ) t WHERE rn=1
            """,
            (start, end),
        )
        last_nat = {r["driver"]: r["nationality"] for r in cur.fetchall()}

        # All teams per driver in the decade
        cur = self._conn.execute(
            """
            SELECT driver, team
            FROM drivers_standings
            WHERE year BETWEEN ? AND ?
            """,
            (start, end),
        )
        teams_all: dict[str, set[str]] = {}
        for r in cur.fetchall():
            d = r["driver"]
            t = r["team"] or ""
            if not t:
                continue
            teams_all.setdefault(d, set()).add(t)

        # Years active (first–last) per driver for display
        cur = self._conn.execute(
            "SELECT driver, MIN(year) AS first_year, MAX(year) AS last_year FROM drivers_standings GROUP BY driver"
        )
        year_spans_dec = {r["driver"]: (r["first_year"], r["last_year"]) for r in cur.fetchall()}
        # Normalize and score
        max_w = max(wins.values()) if wins else 1
        max_f = max(fl.values()) if fl else 1
        # Total races in decade
        cur = self._conn.execute("SELECT COUNT(*) AS c FROM races WHERE year BETWEEN ? AND ?", (start, end))
        total_races_dec = int(cur.fetchone()["c"] or 0)
        cards: List[dict] = []
        for base in rows:
            d = base["driver"]
            first_yr, last_yr = year_spans_dec.get(d, (None, None))
            years_active_dec = f"{first_yr}–{last_yr}" if first_yr and last_yr else (str(first_yr) if first_yr else "—")
            pts = float(base["points"] or 0)
            pts_norm = pts / max_points * 100.0
            pts_modern_dec = float(modern_points_dec.get(d, 0.0))
            pts_modern_norm_dec = round(pts_modern_dec / (max_modern_dec or 1) * 100.0, 2)
            w = int(wins.get(d, 0))
            f = int(fl.get(d, 0))
            wins_norm = (w / max_w * 100.0) if max_w else 0.0
            fl_norm = (f / max_f * 100.0) if max_f else 0.0
            overall_raw = 0.6 * pts_norm + 0.3 * wins_norm + 0.1 * fl_norm
            championships, legacy_bonus = self._compute_driver_legacy(d)
            overall = round(min(100.0, 65.0 + overall_raw * 0.35), 2)
            seasons_in_decade = int(base["seasons"] or 0)
            # Career seasons up to end of decade for legacy bonus component
            seasons_career, exp_score_career = self._compute_driver_experience_score(d, up_to_year=end)
            legacy_overall = round(min(100.0, overall + legacy_bonus + seasons_career * 0.10), 2)
            experience_bonus = round(seasons_career * 0.10, 2)

            # Experience shown in Ratings should reflect period only
            exp_score = float(min(100.0, 50.0 + seasons_in_decade * 3.75))
            # Decade team win/loss across seasons in decade
            drv_w_dec, tm_w_dec = self._decade_team_win_loss(start, d)
            # World titles within decade
            cur_titles_dec = self._conn.execute(
                "SELECT COUNT(*) AS c FROM drivers_standings WHERE driver=? AND position=1 AND year BETWEEN ? AND ?",
                (d, start, end),
            )
            titles_decade = int(cur_titles_dec.fetchone()["c"] or 0)
            # Badges (decade)
            badges: List[str] = []
            if legacy_overall >= 100.0:
                badges.append("Decade GOAT")
            if w == max_w:
                badges.append("Wins leader")
            if f == max_f:
                badges.append("Fastest-lap leader")
            # Teammate sweep across decade (never lost to a teammate; won at least once)
            if tm_w_dec == 0 and drv_w_dec > 0:
                badges.append("Teammate sweep")
            # Champion at least once during the decade
            cur = self._conn.execute(
                "SELECT 1 FROM drivers_standings WHERE driver=? AND position=1 AND year BETWEEN ? AND ? LIMIT 1",
                (d, start, end),
            )
            if cur.fetchone() is not None:
                badges.append("Champion")
            # Career longevity up to end of decade
            if seasons_career > 15:
                badges.append("Veteran")
            # Derived metrics
            dominance_index = round(0.5 * wins_norm + 0.5 * fl_norm, 2)
            tb_den = drv_w_dec + tm_w_dec
            teammate_battle_ratio = round(drv_w_dec / tb_den, 3) if tb_den else None
            legacy_detail = self._compute_driver_legacy_detail(d)
            # Decade fun stats
            cur = self._conn.execute(
                "SELECT\n                   COUNT(DISTINCT (CAST(year AS TEXT) || '-' || CAST(round AS TEXT))) AS starts,\n                   COUNT(DISTINCT CASE WHEN position_order BETWEEN 1 AND 3 THEN (CAST(year AS TEXT) || '-' || CAST(round AS TEXT)) END) AS podiums,\n                   COUNT(DISTINCT CASE WHEN position_order BETWEEN 1 AND 10 THEN (CAST(year AS TEXT) || '-' || CAST(round AS TEXT)) END) AS top10,\n                   COUNT(DISTINCT CASE WHEN position_order=0 THEN (CAST(year AS TEXT) || '-' || CAST(round AS TEXT)) END) AS dnfs\n                 FROM race_results WHERE driver=? AND year BETWEEN ? AND ?",
                (d, start, end),
            )
            rs = cur.fetchone()
            starts_dec = int((rs and rs["starts"]) or 0)
            podiums_dec = int((rs and rs["podiums"]) or 0)
            top10_dec = int((rs and rs["top10"]) or 0)
            dnfs_dec = int((rs and rs["dnfs"]) or 0)
            rate_den_dec = starts_dec or total_races_dec
            win_rate = round((w / rate_den_dec) * 100.0, 2) if rate_den_dec else 0.0
            fl_rate = round((f / rate_den_dec) * 100.0, 2) if rate_den_dec else 0.0
            podium_rate_dec = round((podiums_dec / starts_dec) * 100.0, 2) if starts_dec else 0.0
            top10_rate_dec = round((top10_dec / starts_dec) * 100.0, 2) if starts_dec else 0.0
            modern_pps_dec = round((pts_modern_dec / starts_dec), 2) if starts_dec else 0.0
            # Win streak across decade
            cur = self._conn.execute(
                "SELECT year, round, position_order FROM race_results WHERE driver=? AND year BETWEEN ? AND ? ORDER BY year, round",
                (d, start, end),
            )
            streak = 0
            best_streak = 0
            for rr in cur.fetchall():
                if int(rr["position_order"] or 0) == 1:
                    streak += 1
                    if streak > best_streak:
                        best_streak = streak
                else:
                    streak = 0
            win_streak_dec = best_streak
            # Decisive wins: last race of each season
            cur = self._conn.execute(
                "SELECT r.year, MAX(r.round) AS last_round FROM races r WHERE r.year BETWEEN ? AND ? GROUP BY r.year",
                (start, end),
            )
            decisive = 0
            for yr, lr in [(row["year"], row["last_round"]) for row in cur.fetchall()]:
                rlast = self._conn.execute(
                    "SELECT 1 FROM race_results WHERE year=? AND round=? AND driver=? AND position_order=1 LIMIT 1",
                    (yr, lr, d),
                ).fetchone()
                if rlast is not None:
                    decisive += 1
            cards.append({
                "driver": d,
                "team": last_team.get(d, ""),
                "teams": sorted(list(teams_all.get(d, set()))),
                "nationality": last_nat.get(d, ""),
                "years_active": years_active_dec,
                "points": round(pts, 2),
                "points_modern": round(pts_modern_dec, 2),
                "points_modern_norm": pts_modern_norm_dec,
                "wins": w,
                "fastest_laps": f,
                "seasons": int(base["seasons"] or 0),
                "overall": overall,
                "legacy_overall": legacy_overall,
                "championships": championships,
                "titles_decade": titles_decade,
                "legacy_bonus": legacy_bonus,
                "experience_bonus": experience_bonus,
                "experience": exp_score,  # period experience
                "career_seasons": seasons_career,
                "teammate_wins": tm_w_dec,
                "team_driver_wins": drv_w_dec,
                "win_rate": win_rate,
                "fl_rate": fl_rate,
                "dominance_index": dominance_index,
                # Fun stats decade
                "starts": starts_dec,
                "podiums": podiums_dec,
                "podium_rate": podium_rate_dec,
                "top10": top10_dec,
                "top10_rate": top10_rate_dec,
                "dnfs": dnfs_dec,
                "points_modern": round(pts_modern_dec, 2),
                "points_modern_norm": pts_modern_norm_dec,
                "modern_pps": modern_pps_dec,
                "win_streak": win_streak_dec,
                "clutch_wins": decisive,
                "legacy": {
                    "overall": legacy_overall,
                    "championships": championships,
                    "bonus": legacy_bonus,
                    "experience_bonus": experience_bonus,  # career bonus
                    "experience": exp_score_career,        # career experience
                    "years": seasons_career,
                    "detail": legacy_detail,
                },
                "battles": {
                    "teammate": {
                        "wins": drv_w_dec,
                        "losses": tm_w_dec,
                        "ratio": teammate_battle_ratio,
                    },
                    "wins_vs_fl": {
                        "wins": w,
                        "fastest_laps": f,
                        "diff": w - f,
                    },
                    "points_share": round(pts_norm := (pts / max_points * 100.0 if max_points else 0.0), 2) / 100.0,
                },
                "badges": badges,
            })

        # Rank by modern points primarily, then wins and legacy_overall as tie-breakers
        cards.sort(key=lambda x: (-float(x.get("points", 0) or 0), -int(x.get("wins", 0) or 0), -float(x.get("legacy_overall", 0) or 0)))
        for i, c in enumerate(cards, start=1):
            c["rank"] = i
        return cards

    def driver_alltime_ratings(self) -> List[dict]:
        """
        Aggregate ratings across all available seasons in the database (e.g., 1950–2025).
        Uses modern re-scoring of race classifications where available, with a per-season
        proportional fallback when classifications are missing.
        """
        # Determine range
        yr = self._conn.execute("SELECT MIN(year) AS mn, MAX(year) AS mx FROM seasons").fetchone()
        start = int(yr["mn"] or 1950)
        end = int(yr["mx"] or 2025)
        # Points per driver overall
        cur = self._conn.execute(
            """
            SELECT driver, SUM(points) AS points, COUNT(DISTINCT year) AS seasons
            FROM drivers_standings
            GROUP BY driver
            """
        )
        rows = [dict(r) for r in cur.fetchall()]
        if not rows:
            return []
        max_points = max(r["points"] or 0 for r in rows) or 1

        # Modern points across entire range (per-year: per-race when available, else proportional for older seasons)
        modern_points_all = self._compute_modern_points_for_range_with_fallback(start, end)
        max_modern_all = max(modern_points_all.values()) if modern_points_all else 1

        # Wins overall
        cur = self._conn.execute(
            "SELECT winner AS driver, COUNT(*) AS wins FROM races GROUP BY winner"
        )
        wins = {r["driver"]: r["wins"] for r in cur.fetchall()}

        # Fastest laps overall
        cur = self._conn.execute(
            "SELECT winner AS driver, COUNT(*) AS fl FROM fastest_laps GROUP BY winner"
        )
        fl = {r["driver"]: r["fl"] for r in cur.fetchall()}

        # Total races across full range
        total_races_all = int(self._conn.execute("SELECT COUNT(*) AS c FROM races").fetchone()["c"] or 0)

        # Last known nationality per driver (latest season appearance)
        try:
            cur = self._conn.execute(
                """
                SELECT driver, nationality
                FROM (
                  SELECT driver, nationality, year,
                         ROW_NUMBER() OVER (PARTITION BY driver ORDER BY year DESC) AS rn
                  FROM drivers_standings
                ) t
                WHERE rn=1
                """
            )
            last_nat_all = {r["driver"]: (r["nationality"] or "") for r in cur.fetchall()}
        except Exception:
            last_nat_all = {}

        # Years active (first–last) per driver for display
        cur = self._conn.execute(
            "SELECT driver, MIN(year) AS first_year, MAX(year) AS last_year FROM drivers_standings GROUP BY driver"
        )
        year_spans = {r["driver"]: (r["first_year"], r["last_year"]) for r in cur.fetchall()}
        # All teams per driver across all seasons (same approach as decade ratings)
        cur = self._conn.execute(
            "SELECT driver, team FROM drivers_standings WHERE team IS NOT NULL AND team != ''"
        )
        teams_all: dict[str, set[str]] = {}
        for rr in cur.fetchall():
            teams_all.setdefault(rr["driver"], set()).add(rr["team"])
        # Bonus points per world championship for all-time ranking (fair reward)
        TITLE_BONUS_PTS = 200
        # Precompute career avg finish & race-level teammate H2H in one pass for era-fair legends ratings
        cur = self._conn.execute(
            "SELECT driver, AVG(CASE WHEN position_order > 0 THEN position_order END) AS avg_fin FROM race_results GROUP BY driver"
        )
        all_avg_fin = {r["driver"]: float(r["avg_fin"]) for r in cur.fetchall() if r["avg_fin"] is not None}
        max_w = max(wins.values()) if wins else 1
        max_f = max(fl.values()) if fl else 1
        import math as _math
        cards: List[dict] = []
        for base in rows:
            d = base["driver"]
            pts = float(base["points"] or 0)
            pts_norm = pts / max_points * 100.0
            w = int(wins.get(d, 0))
            f = int(fl.get(d, 0))
            wins_norm = (w / max_w * 100.0) if max_w else 0.0
            fl_norm = (f / max_f * 100.0) if max_f else 0.0
            championships, legacy_bonus = self._compute_driver_legacy(d)
            title_bonus_pts = championships * TITLE_BONUS_PTS
            first_year, last_year = year_spans.get(d, (None, None))
            years_active = f"{first_year}–{last_year}" if (first_year and last_year) else (str(first_year) if first_year else "—")
            seasons_career, exp_score_career = self._compute_driver_experience_score(d, up_to_year=end)
            experience_bonus = round(seasons_career * 0.10, 2)
            exp_score = float(min(100.0, 50.0 + (base["seasons"] or 0) * 3.75))
            drv_w_all, tm_w_all = self._overall_team_win_loss(d)
            dominance_index = round(0.5 * wins_norm + 0.5 * fl_norm, 2)
            legacy_detail = self._compute_driver_legacy_detail(d)
            pts_modern = float(modern_points_all.get(d, 0.0))
            pts_modern_norm = round(pts_modern / (max_modern_all or 1) * 100.0, 2)
            cur = self._conn.execute(
                "SELECT\n                   COUNT(DISTINCT (CAST(year AS TEXT) || '-' || CAST(round AS TEXT))) AS starts,\n                   COUNT(DISTINCT CASE WHEN position_order BETWEEN 1 AND 3 THEN (CAST(year AS TEXT) || '-' || CAST(round AS TEXT)) END) AS podiums,\n                   COUNT(DISTINCT CASE WHEN position_order BETWEEN 1 AND 10 THEN (CAST(year AS TEXT) || '-' || CAST(round AS TEXT)) END) AS top10,\n                   COUNT(DISTINCT CASE WHEN position_order=0 THEN (CAST(year AS TEXT) || '-' || CAST(round AS TEXT)) END) AS dnfs\n                 FROM race_results WHERE driver=?",
                (d,),
            )
            rs = cur.fetchone()
            starts_all = int((rs and rs["starts"]) or 0)
            podiums_all = int((rs and rs["podiums"]) or 0)
            top10_all = int((rs and rs["top10"]) or 0)
            dnfs_all = int((rs and rs["dnfs"]) or 0)
            rate_den_all = starts_all or max(1, (base["seasons"] or 1) * 9)

            # Era-Normalized All-Time Overall: blends Peak/Rate Efficiency (58%) + Log-Scaled Volume (42%)
            # Ensures 1950s–90s legends (Fangio, Clark, Lauda, Senna, Prost, Schumacher) stand alongside Hamilton & Verstappen!
            win_rate_eff = (w / rate_den_all) * 100.0
            pod_rate_eff = (podiums_all / rate_den_all) * 100.0 if starts_all else min(85.0, win_rate_eff * 2.1)
            pps_all = pts_modern / rate_den_all
            avg_fin_all = all_avg_fin.get(d)
            fin_all_score = max(0.0, min(100.0, (18.5 - avg_fin_all) / 16.5 * 100.0)) if avg_fin_all else min(100.0, (pps_all / 16.0) * 100.0)
            title_score = min(100.0, (_math.sqrt(championships / 6.0) * 100.0)) if championships > 0 else 0.0
            eff_score = (
                0.34 * min(100.0, ((win_rate_eff / 38.0) ** 0.55) * 100.0)
                + 0.24 * min(100.0, ((pps_all / 16.5) ** 0.62) * 100.0)
                + 0.24 * title_score
                + 0.18 * fin_all_score
            )
            log_pts_score = (_math.log1p(max(0.0, pts_modern)) / max(1e-6, _math.log1p(max_modern_all))) * 100.0
            log_win_score = (_math.log1p(w) / max(1e-6, _math.log1p(max_w))) * 100.0
            h2h_all_score = ((drv_w_all + 2.0) / (drv_w_all + tm_w_all + 4.0)) * 100.0
            vol_score = 0.45 * log_pts_score + 0.35 * log_win_score + 0.20 * h2h_all_score
            sample_all_w = rate_den_all / (rate_den_all + 12.0)
            all_raw = sample_all_w * (0.58 * eff_score + 0.42 * vol_score) + (1.0 - sample_all_w) * 28.0
            overall = round(min(99.0, max(63.0, 62.5 + all_raw * 0.365)), 2)
            legacy_overall = round(min(99.5, overall + legacy_bonus * 0.55 + min(3.0, seasons_career * 0.10)), 2)
            win_rate = round((w / rate_den_all) * 100.0, 2) if rate_den_all else 0.0
            fl_rate = round((f / rate_den_all) * 100.0, 2) if rate_den_all else 0.0
            podium_rate_all = round((podiums_all / starts_all) * 100.0, 2) if starts_all else 0.0
            top10_rate_all = round((top10_all / starts_all) * 100.0, 2) if starts_all else 0.0
            modern_pps_all = round((pts_modern / starts_all), 2) if starts_all else 0.0
            # Longest win streak across career
            cur = self._conn.execute(
                "SELECT year, round, position_order FROM race_results WHERE driver=? ORDER BY year, round",
                (d,),
            )
            streak = 0
            best_streak = 0
            for rr in cur.fetchall():
                if int(rr["position_order"] or 0) == 1:
                    streak += 1
                    if streak > best_streak:
                        best_streak = streak
                else:
                    streak = 0
            win_streak_all = best_streak
            # All-time badges
            badges: List[str] = []
            if legacy_overall >= 100.0:
                badges.append("Legacy GOAT")
            if w == max_w:
                badges.append("Wins leader")
            if f == max_f:
                badges.append("Fastest-lap leader")
            # Career longevity
            if seasons_career > 15:
                badges.append("Veteran")
            cards.append({
                "driver": d,
                "team": "",
                "teams": sorted(teams_all.get(d, set())),
                "nationality": last_nat_all.get(d, ""),
                "years_active": years_active,
                # Raw career championship points (sum of historical points)
                "total_points": round(pts, 2),
                # Show modern re-scored points as the canonical points for all-time
                "points": round(pts_modern, 2),
                "title_bonus_pts": round(title_bonus_pts, 2),
                "points_norm": pts_modern_norm,
                "wins": w,
                "fastest_laps": f,
                "seasons": int(base["seasons"] or 0),
                "overall": overall,
                "legacy_overall": legacy_overall,
                "championships": championships,
                "titles_decade": championships,  # reuse table column for display
                "legacy_bonus": legacy_bonus,
                "experience_bonus": experience_bonus,
                "experience": exp_score,
                "career_seasons": seasons_career,
                "teammate_wins": tm_w_all,
                "team_driver_wins": drv_w_all,
                "win_rate": win_rate,
                "fl_rate": fl_rate,
                "dominance_index": dominance_index,
                "starts": starts_all,
                "podiums": podiums_all,
                "podium_rate": podium_rate_all,
                "top10": top10_all,
                "top10_rate": top10_rate_all,
                "dnfs": dnfs_all,
                "modern_pps": modern_pps_all,
                "win_streak": win_streak_all,
                "legacy": {
                    "overall": legacy_overall,
                    "championships": championships,
                    "bonus": legacy_bonus,
                    "experience_bonus": experience_bonus,
                    "experience": exp_score_career,
                    "years": seasons_career,
                    "detail": legacy_detail,
                },
                "battles": {
                    "teammate": {
                        "wins": drv_w_all,
                        "losses": tm_w_all,
                        "ratio": round(drv_w_all / (drv_w_all + tm_w_all), 3) if (drv_w_all + tm_w_all) else None,
                    },
                    "wins_vs_fl": {"wins": w, "fastest_laps": f, "diff": w - f},
                    "points_share": round(pts_norm / 100.0, 3),
                },
                "badges": badges,
            })

        # Rank: (normalized points + title bonus), then wins, fastest laps, podiums, top-10, starts
        cards.sort(key=lambda x: (
            -(float(x.get("points", 0) or 0) + float(x.get("title_bonus_pts", 0) or 0)),
            -int(x.get("wins", 0) or 0),
            -int(x.get("fastest_laps", 0) or 0),
            -int(x.get("podiums", 0) or 0),
            -int(x.get("top10", 0) or 0),
            -int(x.get("starts", 0) or 0),
        ))
        for i, c in enumerate(cards, start=1):
            c["rank"] = i
        return cards

    # ---------------------- Modern (2025) points helpers ----------------------
    def _modern_points_table(self) -> dict[int, int]:
        """Return the 2025 scoring table (no fastest lap bonus)."""
        return {1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1}

    def _compute_modern_points_for_year(self, year: int) -> dict[str, float]:
        """Compute per-driver points for a given year using modern 2025 scheme.
        Uses race_results.position_order (finish position)."""
        table = self._modern_points_table()
        cur = self._conn.execute(
            "SELECT driver, position_order FROM race_results WHERE year=?",
            (year,),
        )
        totals: dict[str, float] = {}
        for row in cur.fetchall():
            driver = row["driver"]
            pos = row["position_order"]
            if pos is None:
                continue
            pts = table.get(int(pos), 0)
            if not pts:
                continue
            totals[driver] = totals.get(driver, 0.0) + float(pts)
        return totals

    def _compute_modern_points_for_range(self, start_year: int, end_year: int) -> dict[str, float]:
        """Compute per-driver modern points across a year range inclusive (2025 scheme)."""
        table = self._modern_points_table()
        cur = self._conn.execute(
            "SELECT driver, position_order FROM race_results WHERE year BETWEEN ? AND ?",
            (start_year, end_year),
        )
        totals: dict[str, float] = {}
        for row in cur.fetchall():
            driver = row["driver"]
            pos = row["position_order"]
            if pos is None:
                continue
            pts = table.get(int(pos), 0)
            if not pts:
                continue
            totals[driver] = totals.get(driver, 0.0) + float(pts)
        return totals

    # Proportional fallback using standings max and number of races
    def _compute_modern_points_proportional_for_year(self, year: int) -> dict[str, float]:
        """Scale season points into 2025 scheme proportionally by champion's points vs modern maximum.
        modern_max = races*25; ignore FL and special cases except 2014 double final (adds +25).
        """
        # observed max (champion) points in that year
        cur = self._conn.execute("SELECT MAX(points) AS m FROM drivers_standings WHERE year=?", (year,))
        mpts = float(cur.fetchone()["m"] or 0.0)
        if mpts <= 0:
            return {}
        # races that year
        cur = self._conn.execute("SELECT COUNT(*) AS c FROM races WHERE year=?", (year,))
        races = int(cur.fetchone()["c"] or 0)
        modern_max = races * 25.0
        # 2014 double points for last race in reality; to map to pure 2025, we keep uniform 25, so no change
        scale = (modern_max / mpts) if mpts > 0 else 0.0
        cur = self._conn.execute("SELECT driver, points FROM drivers_standings WHERE year=?", (year,))
        out: dict[str, float] = {}
        for r in cur.fetchall():
            out[r["driver"]] = round(float(r["points"] or 0.0) * scale, 2)
        return out

    def _compute_modern_points_proportional_for_range(self, start_year: int, end_year: int) -> dict[str, float]:
        totals: dict[str, float] = {}
        for y in range(start_year, end_year + 1):
            per = self._compute_modern_points_proportional_for_year(y)
            for d, v in per.items():
                totals[d] = totals.get(d, 0.0) + v
        return totals

    def _compute_modern_points_for_range_with_fallback(self, start_year: int, end_year: int) -> dict[str, float]:
        """
        Per-driver modern points across a year range. For each year: use per-race
        re-scoring when race_results are complete enough; otherwise use proportional
        scaling from championship points. Incomplete per-race data (e.g. partial scrapes
        for 1950s) would undercount greats like Fangio, so we require the year's
        per-race leader to have at least 50% of a full season (races*25) before trusting it.
        """
        totals: dict[str, float] = {}
        for y in range(start_year, end_year + 1):
            per_race = self._compute_modern_points_for_year(y)
            cur = self._conn.execute("SELECT COUNT(*) AS c FROM races WHERE year=?", (y,))
            races = int(cur.fetchone()["c"] or 0)
            expected_max = races * 25.0
            actual_max = max(per_race.values()) if per_race else 0.0
            # Use proportional if no per-race data or leader has < 50% of expected (incomplete data)
            if not per_race or (expected_max > 0 and actual_max < 0.5 * expected_max):
                per_race = self._compute_modern_points_proportional_for_year(y)
            for d, v in per_race.items():
                totals[d] = totals.get(d, 0.0) + v
        return totals

    # ---------------------- Legacy metrics helpers ----------------------
    def _compute_driver_legacy(self, driver_name_like: str) -> tuple[int, float]:
        """
        Returns (championships, legacy_bonus) where legacy_bonus is derived from
        the average of top-5 season raw overall ratings (0-100 scale) across career,
        mapped to a 0..5 additive bonus.
        """
        # championships across career
        cur = self._conn.execute(
            "SELECT COUNT(*) AS c FROM drivers_standings WHERE position=1 AND driver LIKE ?",
            (f"%{driver_name_like}%",),
        )
        championships = int(cur.fetchone()["c"])

        # Seasons the driver participated
        cur = self._conn.execute(
            "SELECT DISTINCT year FROM drivers_standings WHERE driver LIKE ? ORDER BY year",
            (f"%{driver_name_like}%",),
        )
        years = [r["year"] for r in cur.fetchall()]
        season_scores: list[float] = []
        for y in years:
            # driver points that year
            cur = self._conn.execute(
                "SELECT points FROM drivers_standings WHERE year=? AND driver LIKE ? LIMIT 1",
                (y, f"%{driver_name_like}%"),
            )
            row = cur.fetchone()
            if not row:
                continue
            pts = float(row["points"] or 0)
            # max points that year
            cur = self._conn.execute(
                "SELECT MAX(points) AS m FROM drivers_standings WHERE year=?",
                (y,),
            )
            mpts = float(cur.fetchone()["m"] or 0) or 1.0
            pnorm = pts / mpts * 100.0

            # wins driver and max wins that year
            cur = self._conn.execute(
                "SELECT COUNT(*) AS w FROM races WHERE year=? AND winner LIKE ?",
                (y, f"%{driver_name_like}%"),
            )
            w = int(cur.fetchone()["w"] or 0)
            cur = self._conn.execute(
                "SELECT MAX(w) AS mw FROM (SELECT winner, COUNT(*) AS w FROM races WHERE year=? GROUP BY winner)",
                (y,),
            )
            mw = int(cur.fetchone()["mw"] or 0) or 1
            wnorm = w / mw * 100.0

            # fastest laps driver and max that year
            cur = self._conn.execute(
                "SELECT COUNT(*) AS f FROM fastest_laps WHERE year=? AND winner LIKE ?",
                (y, f"%{driver_name_like}%"),
            )
            f = int(cur.fetchone()["f"] or 0)
            cur = self._conn.execute(
                "SELECT MAX(f) AS mf FROM (SELECT winner, COUNT(*) AS f FROM fastest_laps WHERE year=? GROUP BY winner)",
                (y,),
            )
            mf = int(cur.fetchone()["mf"] or 0) or 1
            fnorm = f / mf * 100.0

            raw_overall = 0.6 * pnorm + 0.3 * wnorm + 0.1 * fnorm
            season_scores.append(raw_overall)

        if not season_scores:
            return championships, 0.0
        top5 = sorted(season_scores, reverse=True)[:5]
        avg_top5 = sum(top5) / len(top5)
        legacy_bonus = round(avg_top5 * 0.05, 2)  # up to ~5 points
        return championships, legacy_bonus

    def _compute_driver_legacy_detail(self, driver_name_like: str) -> dict:
        """
        Detailed legacy metrics with the top-5 seasons contributing to the legacy bonus.
        Returns {
          championships: int,
          legacy_bonus: float,
          legacy_avg_top5: float,
          legacy_top5: [{year, raw_overall, pnorm, wnorm, fnorm}]
        }
        """
        # championships across career
        cur = self._conn.execute(
            "SELECT COUNT(*) AS c FROM drivers_standings WHERE position=1 AND driver LIKE ?",
            (f"%{driver_name_like}%",),
        )
        championships = int(cur.fetchone()["c"])

        cur = self._conn.execute(
            "SELECT DISTINCT year FROM drivers_standings WHERE driver LIKE ? ORDER BY year",
            (f"%{driver_name_like}%",),
        )
        years = [r["year"] for r in cur.fetchall()]
        items: list[dict] = []
        for y in years:
            cur = self._conn.execute(
                "SELECT points FROM drivers_standings WHERE year=? AND driver LIKE ? LIMIT 1",
                (y, f"%{driver_name_like}%"),
            )
            row = cur.fetchone()
            if not row:
                continue
            pts = float(row["points"] or 0)
            cur = self._conn.execute(
                "SELECT MAX(points) AS m FROM drivers_standings WHERE year=?",
                (y,),
            )
            mpts = float(cur.fetchone()["m"] or 0) or 1.0
            pnorm = pts / mpts * 100.0

            cur = self._conn.execute(
                "SELECT COUNT(*) AS w FROM races WHERE year=? AND winner LIKE ?",
                (y, f"%{driver_name_like}%"),
            )
            w = int(cur.fetchone()["w"] or 0)
            cur = self._conn.execute(
                "SELECT MAX(w) AS mw FROM (SELECT winner, COUNT(*) AS w FROM races WHERE year=? GROUP BY winner)",
                (y,),
            )
            mw = int(cur.fetchone()["mw"] or 0) or 1
            wnorm = w / mw * 100.0

            cur = self._conn.execute(
                "SELECT COUNT(*) AS f FROM fastest_laps WHERE year=? AND winner LIKE ?",
                (y, f"%{driver_name_like}%"),
            )
            f = int(cur.fetchone()["f"] or 0)
            cur = self._conn.execute(
                "SELECT MAX(f) AS mf FROM (SELECT winner, COUNT(*) AS f FROM fastest_laps WHERE year=? GROUP BY winner)",
                (y,),
            )
            mf = int(cur.fetchone()["mf"] or 0) or 1
            fnorm = f / mf * 100.0

            raw_overall = 0.6 * pnorm + 0.3 * wnorm + 0.1 * fnorm
            items.append({"year": y, "raw_overall": round(raw_overall, 2), "pnorm": round(pnorm, 2), "wnorm": round(wnorm, 2), "fnorm": round(fnorm, 2)})

        if not items:
            return {"championships": championships, "legacy_bonus": 0.0, "legacy_avg_top5": 0.0, "legacy_top5": []}

        top5 = sorted(items, key=lambda x: x["raw_overall"], reverse=True)[:5]
        avg_top5 = round(sum(x["raw_overall"] for x in top5) / len(top5), 2)
        legacy_bonus = round(avg_top5 * 0.05, 2)
        return {
            "championships": championships,
            "legacy_bonus": legacy_bonus,
            "legacy_avg_top5": avg_top5,
            "legacy_top5": top5,
        }

    def _compute_driver_experience_score(self, driver_name_like: str, up_to_year: int | None = None) -> tuple[int, float]:
        if up_to_year is not None:
            cur = self._conn.execute(
                "SELECT COUNT(DISTINCT year) AS c FROM drivers_standings WHERE driver LIKE ? AND year <= ?",
                (f"%{driver_name_like}%", up_to_year),
            )
        else:
            cur = self._conn.execute(
                "SELECT COUNT(DISTINCT year) AS c FROM drivers_standings WHERE driver LIKE ?",
                (f"%{driver_name_like}%",),
            )
        seasons = int(cur.fetchone()["c"] or 0)
        score = float(min(100.0, 50.0 + seasons * 3.75))
        return seasons, score

    def _teammate_wins_season(self, year: int, driver_name_like: str) -> int:
        # Find the driver's team that season
        cur = self._conn.execute(
            "SELECT team FROM drivers_standings WHERE year=? AND driver LIKE ? LIMIT 1",
            (year, f"%{driver_name_like}%"),
        )
        row = cur.fetchone()
        if not row:
            return 0
        team = row["team"]
        # Teammates in standings (approximation)
        cur = self._conn.execute(
            "SELECT driver FROM drivers_standings WHERE year=? AND team=?",
            (year, team),
        )
        drivers = [r["driver"] for r in cur.fetchall()]
        teammates = [d for d in drivers if d.lower() != driver_name_like.lower()]
        if not teammates:
            return 0
        # Count races won by teammates
        qmarks = ",".join(["?"] * len(teammates))
        cur = self._conn.execute(
            f"SELECT COUNT(*) AS c FROM races WHERE year=? AND winner IN ({qmarks})",
            (year, *teammates),
        )
        return int(cur.fetchone()["c"] or 0)

    def _teammate_wins_decade(self, decade_start: int, driver_name_like: str) -> int:
        start = decade_start
        end = decade_start + 9
        total = 0
        # Driver's seasons and teams in the decade
        cur = self._conn.execute(
            "SELECT year, team FROM drivers_standings WHERE driver LIKE ? AND year BETWEEN ? AND ?",
            (f"%{driver_name_like}%", start, end),
        )
        rows = cur.fetchall()
        for r in rows:
            y = r["year"]
            team = r["team"]
            cur_tm = self._conn.execute(
                "SELECT driver FROM drivers_standings WHERE year=? AND team=?",
                (y, team),
            )
            drivers = [rr["driver"] for rr in cur_tm.fetchall()]
            teammates = [d for d in drivers if d.lower() != driver_name_like.lower()]
            if not teammates:
                continue
            qmarks = ",".join(["?"] * len(teammates))
            cur_w = self._conn.execute(
                f"SELECT COUNT(*) AS c FROM races WHERE year=? AND winner IN ({qmarks})",
                (y, *teammates),
            )
            total += int(cur_w.fetchone()["c"] or 0)
        return total

    def _season_race_teammate_h2h(self, year: int) -> dict[str, tuple[int, int]]:
        """Compute true race-by-race teammate head-to-head wins/losses from race_results."""
        cur = self._conn.execute(
            """
            SELECT round, team, driver, position_order
            FROM race_results
            WHERE year=? AND team IS NOT NULL AND team != '' AND position_order > 0
            ORDER BY round, team, position_order
            """,
            (year,),
        )
        by_rt: dict[tuple[int, str], list[tuple[str, int]]] = {}
        for r in cur.fetchall():
            by_rt.setdefault((int(r["round"]), str(r["team"])), []).append((str(r["driver"]), int(r["position_order"])))
        counts: dict[str, list[int]] = {}
        for entries in by_rt.values():
            if len(entries) < 2:
                continue
            for i in range(len(entries)):
                d1, p1 = entries[i]
                for j in range(i + 1, len(entries)):
                    d2, p2 = entries[j]
                    if d1 == d2 or p1 == p2:
                        continue
                    c1 = counts.setdefault(d1, [0, 0])
                    c2 = counts.setdefault(d2, [0, 0])
                    if p1 < p2:
                        c1[0] += 1
                        c2[1] += 1
                    else:
                        c2[0] += 1
                        c1[1] += 1
        return {k: (v[0], v[1]) for k, v in counts.items()}

    def _season_team_win_loss(self, year: int, driver_name_like: str) -> tuple[int, int]:
        # Compare final championship positions vs all teammates for that season
        cur = self._conn.execute(
            "SELECT position, team FROM drivers_standings WHERE year=? AND driver LIKE ? LIMIT 1",
            (year, f"%{driver_name_like}%"),
        )
        row = cur.fetchone()
        if not row:
            return 0, 0
        my_pos = int(row["position"])
        team = row["team"]
        cur = self._conn.execute(
            "SELECT driver, position FROM drivers_standings WHERE year=? AND team=?",
            (year, team),
        )
        wins = 0
        losses = 0
        for rr in cur.fetchall():
            teammate = rr["driver"]
            if teammate.lower() == driver_name_like.lower():
                continue
            tpos = int(rr["position"])
            if my_pos < tpos:
                wins += 1
            elif my_pos > tpos:
                losses += 1
            else:
                # equal positions: ignore
                pass
        return wins, losses

    def _decade_team_win_loss(self, decade_start: int, driver_name_like: str) -> tuple[int, int]:
        start = decade_start
        end = decade_start + 9
        cur = self._conn.execute(
            "SELECT DISTINCT year FROM drivers_standings WHERE driver LIKE ? AND year BETWEEN ? AND ? ORDER BY year",
            (f"%{driver_name_like}%", start, end),
        )
        years = [r["year"] for r in cur.fetchall()]
        w = 0
        l = 0
        for y in years:
            sw, sl = self._season_team_win_loss(y, driver_name_like)
            w += sw
            l += sl
        return w, l

    def _overall_team_win_loss(self, driver_name_like: str) -> tuple[int, int]:
        cur = self._conn.execute(
            "SELECT DISTINCT year FROM drivers_standings WHERE driver LIKE ? ORDER BY year",
            (f"%{driver_name_like}%",),
        )
        years = [r["year"] for r in cur.fetchall()]
        w = 0
        l = 0
        for y in years:
            sw, sl = self._season_team_win_loss(y, driver_name_like)
            w += sw
            l += sl
        return w, l

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
