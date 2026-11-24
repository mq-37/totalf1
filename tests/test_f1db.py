"""Automated tests for TracingInsights F1DB sync, query layer, engine enrichment & HTTP routes."""
from __future__ import annotations

import socket
import threading
import time
import unittest

import requests
import uvicorn

from f1data import driver_dna, era_rules, f1db, performance_balance
from f1data import server as srv


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestTracingInsightsF1DB(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.port = _free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        config = uvicorn.Config(srv.app, host="127.0.0.1", port=cls.port, log_level="error")
        cls._server = uvicorn.Server(config)
        cls._thread = threading.Thread(target=cls._server.run, daemon=True)
        cls._thread.start()
        for _ in range(50):
            try:
                if requests.get(f"{cls.base_url}/api/f1db/status", timeout=0.5).status_code == 200:
                    break
            except Exception:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._server.should_exit = True
        cls._thread.join(timeout=3)

    def test_f1db_status_and_catalog(self) -> None:
        status = f1db.get_f1db_status(srv.DATA_DB)
        self.assertTrue(status["available"])
        self.assertEqual(status["tableCount"], 58)
        self.assertGreater(status["totalRows"], 1_000_000)
        self.assertEqual(status["latestRaceResults"]["year"], 2026)
        self.assertGreaterEqual(status["latestRaceResults"]["round"], 21)

        names = {t["name"] for t in f1db.list_tables(srv.DATA_DB)}
        for req in (
            "drivers",
            "circuits",
            "races_qualifying_results",
            "races_pit_stops",
            "races_safety_cars",
            "races_virtual_safety_cars",
            "races_red_flags",
            "seasons_technical_regulations",
            "seasons_sporting_regulations",
        ):
            self.assertIn(req, names)

    def test_f1db_enriches_driver_dna_balance_and_era_rules(self) -> None:
        with driver_dna._DNA_LOCK:
            driver_dna._DNA_CACHE = None
        all_dna = driver_dna.get_driver_dna_map(srv.DATA_DB)
        self.assertGreaterEqual(len(all_dna), 900)

        ver = driver_dna.get_driver_dna(srv.DATA_DB, "Max Verstappen")
        self.assertTrue(ver["curated"])
        self.assertEqual(ver["f1db"]["f1db_id"], "max-verstappen")
        self.assertGreaterEqual(ver["f1db"]["poles"], 40)
        self.assertGreaterEqual(ver["f1db"]["mech_dnf_pct"], 0)

        bal = performance_balance.get_track_balance_bundle(srv.DATA_DB, "monaco", "2026")
        self.assertIsNotNone(bal["circuit_f1db"])
        self.assertEqual(bal["circuit_f1db"]["circuit"]["id"], "monaco")
        self.assertGreaterEqual(bal["circuit_f1db"]["incidents"]["safetyCarDeployments"], 15)
        self.assertGreater(bal["circuit_f1db"]["pitStops"]["medianPitLaneSec"], 15)

        r2026 = era_rules.get_era_rules(2026)
        self.assertIn("f1db_season", r2026)
        self.assertTrue(r2026["f1db_season"]["activeAeroAllowed"])
        self.assertEqual(r2026["f1db_season"]["minWeightKg"], 768)
        self.assertFalse(r2026["f1db_season"]["drsActive"])

    def test_f1db_http_routes_and_browser_page(self) -> None:
        r_page = requests.get(f"{self.base_url}/f1db", timeout=5)
        self.assertEqual(r_page.status_code, 200)
        self.assertIn("TracingInsights F1DB Intelligence Hub", r_page.text)

        r_stat = requests.get(f"{self.base_url}/api/f1db/status", timeout=5)
        self.assertEqual(r_stat.status_code, 200)
        self.assertEqual(r_stat.json()["tableCount"], 58)

        r_tbl = requests.get(f"{self.base_url}/api/f1db/table/races_safety_cars?year=2026&limit=10", timeout=5)
        self.assertEqual(r_tbl.status_code, 200)
        payload = r_tbl.json()
        self.assertEqual(payload["table"], "races_safety_cars")
        self.assertIn("columns", payload)

        # Safe 404 on invalid table name
        r_bad = requests.get(f"{self.base_url}/api/f1db/table/nonexistent_table;DROP", timeout=5)
        self.assertEqual(r_bad.status_code, 404)

        # 2026 Round 21 (Las Vegas) weekend dossier
        r_race = requests.get(f"{self.base_url}/api/f1db/race/2026/21", timeout=5)
        self.assertEqual(r_race.status_code, 200)
        rd = r_race.json()
        self.assertEqual(rd["race"]["circuitId"], "las-vegas")
        self.assertEqual(len(rd["results"]), 22)

        # Driver profile with family relationships
        r_drv = requests.get(f"{self.base_url}/api/f1db/driver/max-verstappen", timeout=5)
        self.assertEqual(r_drv.status_code, 200)
        dd = r_drv.json()
        self.assertEqual(dd["driver"]["id"], "max-verstappen")
        self.assertTrue(any(f["relatedDriverId"] == "jos-verstappen" for f in dd["family"]))

        # Circuit profile via TRAF1 local slug ("vegas" -> "las-vegas")
        r_cir = requests.get(f"{self.base_url}/api/f1db/circuit/vegas", timeout=5)
        self.assertEqual(r_cir.status_code, 200)
        self.assertEqual(r_cir.json()["circuit"]["id"], "las-vegas")

        # Season dossier (1988 Turbo era)
        r_s = requests.get(f"{self.base_url}/api/f1db/season/1988", timeout=5)
        self.assertEqual(r_s.status_code, 200)
        self.assertGreaterEqual(len(r_s.json()["hardware"]), 10)


if __name__ == "__main__":
    unittest.main()
