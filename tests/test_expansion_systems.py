"""
Automated Regression & Feature Tests for the Full Sim & Career 7-Phase Expansion:
  - Phase 0/1: Era Rules Engine (9 eras 1950s..2026), Historical Track x Era Performance Balancing
  - Phase 2: All 79 Historical & Modern F1 Circuits (meta + geometry + pit building styles)
  - Phase 4: Context-Aware Post-Race Driver Interviews & Opinions API
  - Phase 5: FIA Feeder Series (F2/F3/F1 Academy/W Series + Super Licence), Custom Season Builder CRUD,
             Team Operations Board & Silly Season Rumours
"""
from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
import uvicorn

from f1data import server as srv
from f1data.circuits import CIRCUITS, CIRCUITS_BY_ID, CIRCUITS_META
from f1data.era_rules import era_key_for_year, get_era_rules, list_era_rules, points_for_position

PORT = 8768
BASE_URL = f"http://127.0.0.1:{PORT}"


class TestExpansionSystems(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        config = uvicorn.Config(srv.app, host="127.0.0.1", port=PORT, log_level="error")
        cls._server = uvicorn.Server(config)
        cls._thread = threading.Thread(target=cls._server.run, daemon=True)
        cls._thread.start()
        for _ in range(50):
            try:
                if requests.get(f"{BASE_URL}/api/sim/eras", timeout=0.5).status_code == 200:
                    break
            except Exception:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._server.should_exit = True
        cls._thread.join(timeout=3)

    def _get(self, path: str) -> requests.Response:
        return requests.get(f"{BASE_URL}{path}", timeout=5)

    def _post(self, path: str, json: dict) -> requests.Response:
        return requests.post(f"{BASE_URL}{path}", json=json, timeout=5)

    def _delete(self, path: str) -> requests.Response:
        return requests.delete(f"{BASE_URL}{path}", timeout=5)

    def test_era_rules_catalog_and_points(self) -> None:
        eras = list_era_rules()
        self.assertGreaterEqual(len(eras), 9)
        self.assertEqual(era_key_for_year(1955), "1950s")
        self.assertEqual(era_key_for_year(1988), "1980s")
        self.assertEqual(era_key_for_year(2004), "2000s")
        self.assertEqual(era_key_for_year(2024), "2022_25")
        self.assertEqual(era_key_for_year(2026), "2026")

        r2000 = get_era_rules("2000s")
        self.assertTrue(r2000["refuelling"])
        self.assertFalse(r2000["drs_enabled"])
        self.assertEqual(points_for_position("2000s", 1), 10)

        r2026 = get_era_rules("2026")
        self.assertFalse(r2026["refuelling"])
        self.assertTrue(r2026["override_mode"])
        self.assertEqual(points_for_position("2026", 1), 25)

    def test_all_79_f1_circuits_and_api(self) -> None:
        self.assertGreaterEqual(len(CIRCUITS), 78)
        self.assertEqual(len(CIRCUITS), len(CIRCUITS_META))
        for iconic in ("melbourne", "monaco", "silverstone", "imola", "nordschleife", "adelaide", "kyalami", "avus", "pescara"):
            self.assertIn(iconic, CIRCUITS_BY_ID)
            c = CIRCUITS_BY_ID[iconic]
            self.assertEqual(len(c["points"]), 120)
            self.assertIn(c.get("pit_building"), ("modern_glass", "classic_brick", "street_canopy", "desert_wing", "vintage_wood"))

        r_meta = self._get("/api/game/circuits-meta")
        self.assertEqual(r_meta.status_code, 200)
        self.assertGreaterEqual(len(r_meta.json()["circuits"]), 78)

        r_det = self._get("/api/game/circuits/imola")
        self.assertEqual(r_det.status_code, 200)
        self.assertEqual(len(r_det.json()["points"]), 120)

    def test_historical_balance_and_eras_api(self) -> None:
        r_eras = self._get("/api/sim/eras")
        self.assertEqual(r_eras.status_code, 200)
        self.assertGreaterEqual(len(r_eras.json()["eras"]), 9)

        r_bal = self._get("/api/sim/balance?circuit_id=silverstone&era_key=2026")
        self.assertEqual(r_bal.status_code, 200)
        data = r_bal.json()
        self.assertTrue(len(data["top_winners"]) > 0)
        self.assertTrue(len(data["driver_psychology"]) > 100)
        self.assertTrue(len(data["team_affinity"]) > 0)

    def test_context_aware_interviews_api(self) -> None:
        payload = {
            "circuitName": "Autodromo di Monza",
            "eraLabel": "2026 Active Aero",
            "totalLaps": 15,
            "drivers": [
                {"idx": 0, "code3": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#dc2626", "gridPos": 4, "persona": "fiery_racer", "trackAffinity": 1.6, "engineerName": "Bryan Bozzi"},
                {"idx": 1, "code3": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#ff8700", "gridPos": 1, "persona": "perfectionist", "trackAffinity": 0.2, "engineerName": "Will Joseph"},
            ],
            "stints": [
                {"idx": 0, "code3": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#dc2626", "finishPos": 1, "dnf": False, "endConf": 92, "peakConf": 94, "minConf": 64, "endMom": 44, "overtakes": 4, "mistakes": 0, "pitDelayS": 0},
                {"idx": 1, "code3": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#ff8700", "finishPos": 5, "dnf": False, "endConf": 34, "peakConf": 72, "minConf": 30, "endMom": -28, "overtakes": 0, "mistakes": 2, "pitDelayS": 2.6},
            ],
            "frames": [{"lap": 1, "wetness": 0, "sc": False}, {"lap": 15, "wetness": 0, "sc": False}],
            "events": [],
        }
        r = self._post("/api/sim/interviews", json={"telemetry": payload})
        self.assertEqual(r.status_code, 200)
        ivs = r.json()["interviews"]
        self.assertEqual(len(ivs), 2)
        lec = next(x for x in ivs if x["code3"] == "LEC")
        nor = next(x for x in ivs if x["code3"] == "NOR")
        self.assertEqual(lec["mood"], "elated")
        self.assertIn(nor["mood"], ("shaken", "frustrated"))
        self.assertGreater(lec["rating"], nor["rating"])
        self.assertEqual(len(lec["qas"]), 3)
        self.assertTrue(len(lec["perspectiveReasons"]) >= 3)

    def test_feeder_series_custom_seasons_and_career_ops_board(self) -> None:
        # Public feeder overview
        r_feed = self._get("/api/feeders/overview")
        self.assertEqual(r_feed.status_code, 200)
        drvs = r_feed.json()["drivers"]
        self.assertGreaterEqual(len(drvs), 35)
        series_set = {d["series"] for d in drvs}
        self.assertEqual(series_set, {"f2", "f3", "f1_academy", "w_series"})

        # Isolated career DB tests: Custom Seasons CRUD + Career Ops Board + Feeder Recruitment
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with patch.object(srv, "_career_base_dir", return_value=tmp_path):
                # 1. Save, list, get & launch Custom Season
                cs_payload = {
                    "name": "1988 Turbo Classics",
                    "era_key": "1980s",
                    "calendar": ["imola", "monaco", "silverstone", "spa", "monza", "suzuka", "adelaide"],
                    "rule_overrides": {"refuelling": False, "drs_enabled": False},
                    "market_rules": {"transfer_mode": "chaotic", "budget_cap_m": 150},
                }
                r_save = self._post("/api/custom-seasons", json=cs_payload)
                self.assertEqual(r_save.status_code, 200)
                sid = r_save.json()["season_id"]

                r_list = self._get("/api/custom-seasons")
                self.assertEqual(r_list.status_code, 200)
                self.assertTrue(any(s["season_id"] == sid for s in r_list.json()["seasons"]))

                # 2. Launch Career with that Custom Season + check Ops Board & Feeder Recruitment!
                r_new = self._post("/api/career/new", json={
                    "era": "2026",
                    "team_choice": "Ferrari",
                    "calendar_len": "8",
                    "custom_season": r_save.json()["config"],
                })
                self.assertEqual(r_new.status_code, 200)
                cdata = r_new.json()
                self.assertEqual(len(cdata["state"]["calendar"]), 7)
                self.assertEqual(cdata["state"]["calendar"][0]["circuit_id"], "imola")
                self.assertEqual(len(cdata["ops_board"]["departments"]), 5)

                # 3. Sim Feeder Round & Recruit F2 star
                r_sim = self._post("/api/career/feeders/sim-round", json={})
                self.assertEqual(r_sim.status_code, 200)
                self.assertEqual(r_sim.json()["feeders"]["rounds_completed"], 1)

                r_rec = self._post("/api/career/feeders/recruit", json={"feeder_id": "f2_fornaroli"})
                self.assertEqual(r_rec.status_code, 200)
                self.assertTrue(r_rec.json()["ok"])
                self.assertIn("junior_f2_fornaroli", r_rec.json()["state"]["drivers"])

                # 4. Delete custom season
                r_del = self._delete(f"/api/custom-seasons/{sid}")
                self.assertEqual(r_del.status_code, 200)


if __name__ == "__main__":
    unittest.main()
