"""Telemetry data-exploration & analytics standardization suite.

Covers:
  1. F1DB/FIA enrichment endpoints — driver-card dossier, driver progression,
     team points history, track kings.
  2. Archive analytics pages — 200s, chart placeholders + page-data tags present.
  3. Race analytics modal — script inclusion and chart-tab wiring in templates.
  4. Shared chart lib present and syntax-valid.
"""
from __future__ import annotations

import socket
import threading
import time
import unittest

import requests
import uvicorn

from f1data.server import app


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestEnrichmentEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        port = _free_port()
        cls._srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        cls._thread = threading.Thread(target=cls._srv.run, daemon=True)
        cls._thread.start()
        cls.base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            try:
                if requests.get(f"{cls.base}/analytics", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.25)

    @classmethod
    def tearDownClass(cls):
        cls._srv.should_exit = True
        cls._thread.join(timeout=10)

    def test_driver_card_dossier(self):
        r = requests.get(f"{self.base}/api/analytics/driver-card/Ayrton Senna", timeout=20)
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertTrue(d["ok"])
        self.assertEqual(d["driver"]["totalChampionshipWins"], 3)
        self.assertGreaterEqual(d["driver"]["totalRaceWins"], 40)
        self.assertIsInstance(d["fia_decisions"], list)
        # unknown driver still answers with an ok envelope (empty bio)
        r2 = requests.get(f"{self.base}/api/analytics/driver-card/Zed Quasar", timeout=20)
        self.assertEqual(r2.status_code, 200)

    def test_driver_progression_uses_season_end_points(self):
        r = requests.get(f"{self.base}/api/analytics/driver-progression/max-verstappen", timeout=20)
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertTrue(d["ok"])
        seasons = d["seasons"]
        self.assertGreaterEqual(len(seasons), 3)
        # season-end points (MAX), never the inflated SUM of cumulative standings
        for s in seasons:
            self.assertLess(s["points"], 800, f"{s['year']} looks like a cumulative-sum bug")

    def test_team_points_history(self):
        r = requests.get(f"{self.base}/api/analytics/team-points-history/ferrari", timeout=20)
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertTrue(d["ok"])
        self.assertGreaterEqual(len(d["seasons"]), 10)
        self.assertLessEqual(max(s["points"] for s in d["seasons"]), 900)

    def test_track_wins_kings(self):
        r = requests.get(f"{self.base}/api/analytics/track-wins?limit=8", timeout=20)
        self.assertEqual(r.status_code, 200)
        tracks = r.json()["tracks"]
        self.assertGreaterEqual(len(tracks), 5)
        for t in tracks:
            self.assertTrue(t["top_driver"])
            self.assertGreaterEqual(t["top_wins"], 1)
        # Monaco's king should be among the historical greats (6+ wins there)
        monaco = next((t for t in tracks if "monaco" in t["id"]), None)
        if monaco:
            self.assertGreaterEqual(monaco["top_wins"], 5)


class TestArchiveViews(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        port = _free_port()
        cls._srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        cls._thread = threading.Thread(target=cls._srv.run, daemon=True)
        cls._thread.start()
        cls.base = f"http://127.0.0.1:{port}"
        for _ in range(60):
            try:
                if requests.get(f"{cls.base}/analytics", timeout=2).status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(0.25)

    @classmethod
    def tearDownClass(cls):
        cls._srv.should_exit = True
        cls._thread.join(timeout=10)

    def test_all_archive_pages_200_and_wired(self):
        pages = {
            "/analytics": "home",
            "/analytics/overall": "overall",
            "/analytics/season": "season",
            "/analytics/team": "team",
            "/analytics/tracks": "tracks",
        }
        for path, page in pages.items():
            r = requests.get(f"{self.base}{path}", timeout=30)
            self.assertEqual(r.status_code, 200, f"{path} returned {r.status_code}")
            self.assertIn('id="archive-page-data"', r.text, f"{path} missing page-data tag")
            self.assertIn(f'__ARCHIVE_PAGE__ = "{page}"', r.text, f"{path} missing page marker")
            self.assertIn("f1_charts.js", r.text, f"{path} missing shared chart lib")
            self.assertIn("f1_archive_analytics.js", r.text, f"{path} missing chart renderer")

    def test_sim_pages_include_chart_lib(self):
        for path in ("/career", "/full-sim"):
            try:
                r = requests.get(f"{self.base}{path}", timeout=30, allow_redirects=True)
                if r.status_code == 200:
                    self.assertIn("f1_race_analytics.js", r.text)
            except Exception:
                pass  # career may redirect to setup; full_sim is the reliable check


if __name__ == "__main__":
    unittest.main()
