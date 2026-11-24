"""
Verification suite for Full GP Weekend Structure, FP1/FP2/FP3 Programmes, Watchable Quali & Live Doppler Weather Radar:
  1. Weekend state initialization, FP1 -> FP2 -> FP3 progression, Parc Fermé enforcement.
  2. Practice Programmes awarding Driver Skill XP/stat boosts, Car Knowledge %, Dev Points, Setup Confidence & Engineer Strategy Intel.
  3. Dev Points spending on instant car part upgrades & R&D acceleration.
  4. Qualifying incorporating Car Knowledge %, FP Quali Pace Bonus & live-watched lap times.
  5. Live Open-Meteo Circuit Weather + Doppler Radar Storm Cells + R&D-Calibrated Optimal Pit & Crossover Calculator.
  6. FastAPI HTTP endpoints (/api/career/weekend, /api/weather/live/{circuit_id}).
"""
from __future__ import annotations

import copy
import socket
import threading
import time
import unittest

import requests
import uvicorn

from f1data import career, circuits, weather_radar, weekend_engine
from f1data.server import app


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestWeekendEngineAndWeather(unittest.TestCase):
    def _isolated_state(self):
        st = career.load_career(career.Path(__file__).resolve().parent.parent)
        self.assertIsNotNone(st, "Expected an active career save for isolated testing")
        st = copy.deepcopy(st)
        st["weekend_state"] = None
        st["weekend_setup"] = None
        st["pending_quali"] = None
        return st

    def test_fp1_fp2_fp3_programmes_award_skills_knowledge_devpoints_and_strategy(self):
        st = self._isolated_state()
        cir = circuits.get_circuit(st["calendar"][st["current_round"] - 1]["circuit_id"])
        ideal = career._ideal_setup_for_circuit(cir)
        wk = weekend_engine.ensure_weekend_state(st, cir, ideal)
        self.assertEqual(wk["current_phase"], "fp1")
        self.assertEqual(wk["car_knowledge_pct"], 12)
        self.assertEqual(wk["strategy_intel"]["accuracy_pct"], 35)

        pt = career.get_player_team(st)
        d0_id = pt["driver_ids"][0]
        xp_before = int(st["drivers"][d0_id].get("xp") or 0)
        dp_before = int(st.get("dev_points") or 0)

        # Complete FP1 with Track Acclimatisation + Tyre Management
        ok1, msg1, wk1 = weekend_engine.complete_practice_session(
            st, "fp1", {"0": "track_acclim", "1": "tyre_mgmt"},
            ideal["wing"], ideal["susp"], ideal["diff"], False,
            {"0": 0.94, "1": 0.92}, None, cir, ideal,
            career.get_player_team, career._compute_car_overall, career._add_inbox,
        )
        self.assertTrue(ok1, msg1)
        self.assertIn("fp1", wk1["completed_sessions"])
        self.assertEqual(wk1["current_phase"], "fp2")
        self.assertGreater(wk1["car_knowledge_pct"], 30)
        self.assertGreater(wk1["strategy_intel"]["accuracy_pct"], 60)
        self.assertGreater(st["dev_points"], dp_before)
        self.assertGreater(st["drivers"][d0_id]["xp"], xp_before)
        self.assertEqual(wk1["setup"]["feedback"]["wing"], "OPTIMAL")

        # Complete FP2 with Aero Correlation + Race Strategy -> NAILED strategy intel & >=100 Dev Points!
        ok2, msg2, wk2 = weekend_engine.complete_practice_session(
            st, "fp2", {"0": "aero_corr", "1": "race_strat"},
            ideal["wing"], ideal["susp"], ideal["diff"], False,
            {"0": 0.95, "1": 0.96}, None, cir, ideal,
            career.get_player_team, career._compute_car_overall, career._add_inbox,
        )
        self.assertTrue(ok2, msg2)
        self.assertEqual(wk2["strategy_intel"]["tier"], "NAILED")
        self.assertGreaterEqual(st["dev_points"], 100)

        # Spend 100 Dev Points on immediate Aero upgrade
        aero_before = float(pt["rd"]["aero"])
        ok_sp, msg_sp = weekend_engine.spend_dev_points(
            st, "aero", career.get_player_team, career._compute_car_overall, career._add_inbox
        )
        self.assertTrue(ok_sp, msg_sp)
        self.assertGreater(pt["rd"]["aero"], aero_before)

    def test_qualifying_accepts_live_watched_times_and_advances_phase(self):
        st = self._isolated_state()
        cir = circuits.get_circuit(st["calendar"][st["current_round"] - 1]["circuit_id"])
        ideal = career._ideal_setup_for_circuit(cir)
        weekend_engine.ensure_weekend_state(st, cir, ideal)

        pt = career.get_player_team(st)
        d0_id = pt["driver_ids"][0]
        target_lap = round(float(cir["base_lap_s"]) - 9.123, 3)
        q1 = career.run_qualifying_stage(st, stage="q1", live_times={d0_id: target_lap})
        self.assertEqual(q1["stage"], "q1_done")
        self.assertEqual(q1["grid"][0]["driver_id"], d0_id)
        self.assertAlmostEqual(q1["grid"][0]["q1_s"], target_lap, places=3)
        self.assertEqual(st["weekend_state"]["current_phase"], "q2")

    def test_weather_radar_and_rd_optimal_pit_crossover_calculations(self):
        spa = circuits.get_circuit("spa")
        # Dry high-R&D vs Showers crossover
        dry_low = weather_radar.build_weather_radar_and_pit_plan(spa, mode="dry", laps=20, intel_pct=40, tyre_care=72)
        dry_hi = weather_radar.build_weather_radar_and_pit_plan(spa, mode="dry", laps=20, intel_pct=96, tyre_care=94)
        self.assertLess(dry_hi["optimal_pit"]["effective_deg_s"], dry_low["optimal_pit"]["effective_deg_s"])
        self.assertLess(dry_hi["optimal_pit"]["uncertainty_laps"], dry_low["optimal_pit"]["uncertainty_laps"])
        self.assertEqual(dry_hi["optimal_pit"]["tier"], "NAILED")

        shw = weather_radar.build_weather_radar_and_pit_plan(spa, mode="showers", laps=15, intel_pct=90, tyre_care=84)
        self.assertGreater(len(shw["radar"]["cells"]), 0)
        self.assertEqual(len(shw["radar"]["timeline"]), 12)
        self.assertTrue(any(p["crossover"] for p in shw["optimal_pit"]["pit_stops"]))


class TestWeekendWeatherHttpEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = _free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        config = uvicorn.Config(app, host="127.0.0.1", port=cls.port, log_level="error")
        cls.server = uvicorn.Server(config)
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(50):
            try:
                if requests.get(f"{cls.base_url}/api/sim/eras", timeout=1).status_code == 200:
                    break
            except Exception:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=3)

    def test_weekend_and_live_weather_endpoints(self):
        r1 = requests.get(f"{self.base_url}/api/career/weekend", timeout=5)
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertTrue(d1["ok"])
        self.assertEqual(len(d1["programmes"]), 6)
        self.assertGreaterEqual(len(d1["roster"]), 18)

        r2 = requests.get(
            f"{self.base_url}/api/weather/live/silverstone?mode=showers&laps=15&intel_pct=92&tyre_care=88",
            timeout=8,
        )
        self.assertEqual(r2.status_code, 200)
        d2 = r2.json()
        self.assertTrue(d2["ok"])
        self.assertIn("live_weather", d2)
        self.assertIn("radar", d2)
        self.assertIn("optimal_pit", d2)
        self.assertEqual(d2["optimal_pit"]["tier"], "NAILED")


if __name__ == "__main__":
    unittest.main()
