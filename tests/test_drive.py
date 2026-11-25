"""Automated backend & persistence tests for Apex POV (/drive)."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from f1data import drive_db as ddb
from f1data import drive_engine as deng
from f1data import ladder_db as ldb
from f1data import ladder_engine as leng
import f1data.server


class TestApexPovDrive(unittest.TestCase):
    def test_session_config_across_circuits_and_eras(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            for cid, era in [("melbourne", "2026"), ("spa", "2000s"), ("monaco", "1980s"), ("monza", "1950s")]:
                cfg = deng.build_drive_session_config(base, circuit_id=cid, era_key=era, mode="gp", laps=5)
                self.assertTrue(cfg["ok"])
                self.assertEqual(cfg["circuit"]["id"], cid)
                self.assertEqual(cfg["era_key"], era)
                self.assertEqual(len(cfg["grid"]), 20)
                self.assertGreater(cfg["f1db_target_lap_ms"], 40_000)
                players = [g for g in cfg["grid"] if g["is_player"]]
                self.assertEqual(len(players), 1)
                self.assertEqual(cfg["physics_dna"]["halo"], era in ("2010s", "2020s", "2026"))

    def test_time_trial_pb_and_ghost_wal_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            ghost = [{"t": 0.1 * i, "p": round(i * 0.01, 4), "l": 0.0, "y": 0.0, "k": 240, "g": 6} for i in range(25)]
            r1 = ddb.save_time_trial(
                base, circuit_id="monza", era_key="2026", driver_name="Alex Vance", team_name="Ferrari",
                best_lap_ms=81250, s1_ms=26500, s2_ms=27800, s3_ms=26950, ghost=ghost,
            )
            self.assertTrue(r1["is_pb"])
            self.assertEqual(r1["best_lap_ms"], 81250)

            # Slower lap must NOT overwrite PB
            r2 = ddb.save_time_trial(
                base, circuit_id="monza", era_key="2026", driver_name="Alex Vance", team_name="Ferrari",
                best_lap_ms=82900,
            )
            self.assertFalse(r2["is_pb"])
            self.assertEqual(r2["best_lap_ms"], 81250)

            # Faster lap updates PB
            r3 = ddb.save_time_trial(
                base, circuit_id="monza", era_key="2026", driver_name="Alex Vance", team_name="Ferrari",
                best_lap_ms=79940, ghost=ghost,
            )
            self.assertTrue(r3["is_pb"])
            loaded = ddb.load_time_trial(base, "monza", "2026")
            self.assertEqual(loaded["best_lap_ms"], 79940)
            self.assertEqual(len(loaded["ghost"]), 25)

            integ = ddb.check_drive_integrity(base)
            self.assertTrue(integ["ok"])
            self.assertEqual(integ["journal_mode"], "wal")
            self.assertEqual(integ["missing_tables"], [])

    def test_driver_career_season_acclaim_h2h_and_contracts(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            st = deng.build_new_driver_career(driver_name="Maya Reid", driver_number=23, team_name="Williams", season_rounds=4)
            sid = ddb.save_career(base, st)
            self.assertEqual(len(ddb.list_careers(base)), 1)

            # Complete all 4 rounds finishing P1 every race -> triggers season_end & contract offers
            for rd in range(1, 5):
                standings = [{"driver_id": "player", "name": "Maya Reid", "pos": 1, "dnf": False}]
                pos = 2
                for g in st["grid"]:
                    if g["driver_id"] == "player":
                        continue
                    standings.append({"driver_id": g["driver_id"], "name": g["name"], "pos": pos, "dnf": False})
                    pos += 1
                res = deng.commit_driver_career_race(st, standings=standings, player_grid_pos=1, best_lap_ms=79500, fastest_lap_driver_id="player")
                self.assertEqual(res["points_scored"], 26.0)
                self.assertTrue(res["beat_teammate"])
                ddb.append_race_history(
                    base, sid, season=1, round_num=res["round"], circuit_id=res["circuit_id"],
                    grid_pos=1, finish_pos=1, best_lap_ms=79500, points_scored=26.0, summary=res,
                )
            ddb.save_career(base, st)

            self.assertEqual(st["phase"], "season_end")
            self.assertEqual(st["player"]["h2h_wins"], 4)
            self.assertGreaterEqual(len(st["contract_offers"]), 2)
            self.assertEqual(len(ddb.list_race_history(base, sid)), 4)

            # Sign with a top constructor for Season 2
            top_offer = st["contract_offers"][0]["team"]
            ok, msg = deng.sign_driver_career_contract(st, top_offer)
            self.assertTrue(ok, msg)
            self.assertEqual(st["season"], 2)
            self.assertEqual(st["round"], 1)
            self.assertEqual(st["player"]["team"], top_offer)
            self.assertTrue(ddb.delete_career(base, sid))

    def test_take_the_wheel_ladder_bridge_and_health_integrity(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            lst = leng.build_new_ladder(team_name="Bridge Motorsport", start_tier="f3", seed=303)
            lsid = ldb.save_state(base, lst)
            cfg = deng.build_drive_session_config(base, source="ladder", ref_id=lsid)
            self.assertIsNotNone(cfg)
            self.assertEqual(cfg["mode"], "bridge")
            self.assertEqual(cfg["era_key"], "f3")
            self.assertEqual(cfg["bridge"]["source"], "ladder")
            self.assertEqual(cfg["bridge"]["commit_url"], f"/api/ladder/{lsid}/race/commit")
            self.assertTrue(any(g["is_player"] for g in cfg["grid"]))

        resp = f1data.server.api_health()
        payload = json.loads(resp.body.decode("utf-8"))
        self.assertIn("drive_world_integrity", payload)
        self.assertTrue(payload["drive_world_integrity"]["ok"])

    def test_paddock_hq_stories_commitments_cards_lore_and_rebrand(self) -> None:
        import asyncio
        import socket
        import threading
        import time
        import urllib.request
        import uvicorn
        from f1data import drive_paddock as dpaddock

        orig_base = f1data.server._career_base_dir
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            f1data.server._career_base_dir = lambda: base
            # 1. Direct Paddock HQ engine + Career Story & Commitment WAL Persistence
            pad = dpaddock.build_paddock_payload(
                base, circuit_id="monza", era_key="2026", team_name="Ferrari", driver_name="Marco Bellini"
            )
            self.assertTrue(pad["ok"])
            self.assertGreaterEqual(len(pad["stories"]), 2)
            self.assertGreaterEqual(len(pad["commitments"]), 5)
            self.assertGreaterEqual(len(pad["news_feed"]), 2)
            self.assertGreaterEqual(len(pad["social_feed"]), 2)
            self.assertEqual(pad["player_card"]["name"], "Marco Bellini")
            self.assertGreaterEqual(len(pad["grid_cards"]), 18)
            self.assertGreaterEqual(len(pad["legend_cards"]), 5)
            self.assertEqual(pad["lore"]["circuit"]["id"], "monza")
            self.assertGreaterEqual(len(pad["lore"]["tp_dossiers"]), 5)
            self.assertGreaterEqual(len(pad["lore"]["ecosystem"]), 5)

            st = deng.build_new_driver_career(
                driver_name="Elena Vance", driver_number=33, team_name="McLaren", season_rounds=4
            )
            sid = ddb.save_career(base, st)
            loaded = ddb.load_career(base, sid)
            p_car = dpaddock.build_paddock_payload(base, career_state=loaded)
            self.assertTrue(p_car["metrics"]["career_active"])
            story = p_car["stories"][0]
            choice = story["choices"][0]

            ok_s, _msg_s, _extra_s = dpaddock.resolve_story_choice(loaded, story["id"], choice["id"])
            self.assertTrue(ok_s)
            ddb.save_career(base, loaded)
            reloaded = ddb.load_career(base, sid)
            self.assertEqual(len(reloaded["pending_stories"]), len(p_car["stories"]) - 1)
            self.assertGreaterEqual(len(reloaded["story_history"]), 1)

            ok_c, _msg_c, _extra_c = dpaddock.execute_commitment(reloaded, "sim_cal")
            self.assertTrue(ok_c)
            ddb.save_career(base, reloaded)
            reloaded2 = ddb.load_career(base, sid)
            self.assertTrue(any(b["key"] == "grip_boost" for b in reloaded2["active_buffs"]))

            # 2. Live HTTP check for APEX GRID rebrand & /api/drive/paddock
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
            cfg = uvicorn.Config(f1data.server.app, host="127.0.0.1", port=port, log_level="error")
            server = uvicorn.Server(cfg)
            th = threading.Thread(target=server.run, daemon=True)
            th.start()
            try:
                for _ in range(40):
                    try:
                        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1)
                        break
                    except Exception:
                        time.sleep(0.1)
                for route in ("/", "/drive", "/sim"):
                    html = urllib.request.urlopen(f"http://127.0.0.1:{port}{route}", timeout=5).read().decode("utf-8")
                    self.assertIn("APEX", html)
                    self.assertIn("GRID", html)
                    self.assertNotIn("Local F1", html)
                api_res = json.loads(
                    urllib.request.urlopen(
                        f"http://127.0.0.1:{port}/api/drive/paddock?save_id={sid}", timeout=5
                    ).read().decode("utf-8")
                )
                self.assertTrue(api_res["ok"])
                self.assertTrue(api_res["metrics"]["career_active"])
            finally:
                server.should_exit = True
                th.join(timeout=3)
                f1data.server._career_base_dir = orig_base


if __name__ == "__main__":
    unittest.main()
