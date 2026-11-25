"""Permanent HTTP, API, PDF, edge-case, and isolated POST mutation test suite for traf1.

Run from the traf1 directory:
    .venv/bin/python -m unittest tests/test_routes.py -v
"""
from __future__ import annotations

import shutil
import socket
import tempfile
import threading
import time
import unittest
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path

import requests
import uvicorn

from f1data import server as srv_mod


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[tuple[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        d = dict(attrs)
        if tag in ("img", "script") and d.get("src"):
            self.assets.append((tag, d["src"]))
        elif tag == "link" and d.get("href"):
            self.assets.append((tag, d["href"]))


class _EmbeddedServer:
    """Run FastAPI app in a background thread on an ephemeral localhost port."""

    def __init__(self) -> None:
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        config = uvicorn.Config(srv_mod.app, host="127.0.0.1", port=self.port, log_level="error")
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    def start(self) -> None:
        self._thread.start()
        deadline = time.time() + 15.0
        while time.time() < deadline:
            try:
                r = requests.get(f"{self.base_url}/api/seasons", timeout=2)
                if r.status_code == 200:
                    return
            except Exception:
                pass
            time.sleep(0.1)
        raise RuntimeError("Embedded uvicorn server failed to start")

    def stop(self) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=5)


class TestReadRoutes(unittest.TestCase):
    """Read-only verification of every HTML page, JSON API, PDF export, and edge case."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.srv = _EmbeddedServer()
        cls.srv.start()
        cls.base_url = cls.srv.base_url
        cls.sess = requests.Session()
        seasons = cls.sess.get(f"{cls.base_url}/api/seasons", timeout=5).json()
        cls.latest = seasons[-1]
        drivers = cls.sess.get(f"{cls.base_url}/api/drivers/{cls.latest}", timeout=5).json()
        teams = cls.sess.get(f"{cls.base_url}/api/teams/{cls.latest}", timeout=5).json()
        cls.sample_driver = drivers[0]["driver"] if drivers else "Lewis Hamilton HAM"
        cls.sample_team = teams[0]["team"] if teams else "Ferrari"
        cls.sample_driver_slug = urllib.parse.quote(cls.sample_driver.replace(" ", "-"))
        cls.sample_team_slug = urllib.parse.quote(cls.sample_team.replace(" ", "-"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.sess.close()
        cls.srv.stop()

    def test_all_html_routes_and_local_assets(self) -> None:
        routes = [
            "/",
            "/race",
            f"/races/{self.latest}",
            "/races/1950",
            "/races/1988",
            f"/drivers/{self.latest}",
            "/drivers/1950",
            f"/teams/{self.latest}",
            "/teams/1988",
            f"/awards/{self.latest}",
            "/cards",
            f"/cards?year={self.latest}",
            "/cards?year=1988",
            "/cards/decade",
            "/cards/decade?decade=1980",
            "/cards/alltime",
            "/play",
            "/sim",
            "/career",
            "/ladder",
            "/drive",
            "/driver",
            "/driver?q=Hamilton",
            f"/driver/{self.sample_driver_slug}",
            f"/team/{self.sample_team_slug}",
            "/analytics",
            "/analytics/overall",
            "/analytics/season",
            f"/analytics/season?year={self.latest}",
            "/analytics/team",
            f"/analytics/team?team={urllib.parse.quote(self.sample_team)}",
            "/analytics/tracks",
            "/analytics/tracks?track=Monaco",
            "/admin/teams/colors",
            "/teams/colors",
            "/team-colors",
            f"/drivers/{self.latest}/edit/1",
            f"/drivers/{self.latest}/row/1",
            "/dev/car-composition",
            "/dev/car-composition-v2",
            "/dev/car-liveries",
            "/dev/car-3d",
        ]
        checked_assets: dict[str, int] = {}
        for path in routes:
            with self.subTest(path=path):
                r = self.sess.get(f"{self.base_url}{path}", timeout=20)
                self.assertEqual(r.status_code, 200, f"{path} returned {r.status_code}")
                self.assertNotIn("Traceback", r.text)
                parser = _AssetParser()
                parser.feed(r.text)
                for tag, src in parser.assets:
                    if src.startswith(("http://", "https://", "data:")):
                        continue
                    asset_url = src if src.startswith("/") else f"/{src}"
                    if asset_url not in checked_assets:
                        ar = self.sess.get(f"{self.base_url}{asset_url}", timeout=5)
                        checked_assets[asset_url] = ar.status_code
                    self.assertLess(
                        checked_assets[asset_url],
                        400,
                        f"Broken local {tag} asset {asset_url} on {path} (HTTP {checked_assets[asset_url]})",
                    )

    def test_all_read_api_routes(self) -> None:
        api_paths = [
            "/api/seasons",
            "/api/health",
            "/api/ladder/saves",
            "/api/drive/config?circuit=melbourne&era=2026&mode=timetrial",
            "/api/drive/leaderboards",
            "/api/drive/careers",
            f"/api/races/{self.latest}",
            f"/api/drivers/{self.latest}",
            f"/api/teams/{self.latest}",
            f"/api/awards/{self.latest}",
            "/api/analytics/driver-total-points",
            "/api/analytics/driver-total-points?q=Hamilton",
            "/api/analytics/driver-champions",
            "/api/analytics/constructor-champions",
            f"/api/analytics/wins/{self.latest}",
            "/api/driver/search?q=Hamilton",
            "/api/driver/search?q=",
            f"/api/team/{self.sample_team_slug}",
            f"/api/ratings/season/{self.latest}",
            "/api/ratings/decade/1980",
            f"/api/car/{self.sample_team_slug}/palette",
            f"/api/car/{self.sample_team_slug}/voxels",
            f"/api/game/deck?source=season&year={self.latest}",
            "/api/game/deck?source=alltime&limit=20",
            "/api/game/tracks",
            "/api/game/circuits",
            "/api/missing/driver-images?limit=5",
            f"/api/prefetch/driver-image?driver={self.sample_driver_slug}",
        ]
        for path in api_paths:
            with self.subTest(path=path):
                r = self.sess.get(f"{self.base_url}{path}", timeout=20)
                self.assertEqual(r.status_code, 200, f"{path} returned {r.status_code}")
                r.json()  # must be valid JSON

        # Unknown voxel team returns 404
        r404 = self.sess.get(f"{self.base_url}/api/car/nonexistent-team-xyz/voxels", timeout=5)
        self.assertEqual(r404.status_code, 404)

    def test_security_data_directory_not_exposed(self) -> None:
        self.assertEqual(self.sess.get(f"{self.base_url}/data/f1.sqlite", timeout=5).status_code, 404)
        self.assertEqual(self.sess.get(f"{self.base_url}/data/career_saves.sqlite", timeout=5).status_code, 404)
        self.assertEqual(self.sess.get(f"{self.base_url}/data/ladder_saves.sqlite", timeout=5).status_code, 404)
        self.assertEqual(self.sess.get(f"{self.base_url}/data/drive_saves.sqlite", timeout=5).status_code, 404)
        self.assertEqual(self.sess.get(f"{self.base_url}/data/driver_images/../../f1.sqlite", timeout=5).status_code, 404)
        self.assertEqual(self.sess.get(f"{self.base_url}/data/flags/gb.png", timeout=5).status_code, 200)

    def test_race_calendar_renders_races(self) -> None:
        r = self.sess.get(f"{self.base_url}/race", timeout=15)
        self.assertEqual(r.status_code, 200)
        self.assertIn("<table>", r.text)
        self.assertNotIn("No races loaded", r.text)

    def test_hyphenated_driver_and_team_slugs(self) -> None:
        r_drv = self.sess.get(f"{self.base_url}/driver/Jean-Pierre-Beltoise-BEL", timeout=10)
        self.assertEqual(r_drv.status_code, 200)
        self.assertIn("Jean-Pierre Beltoise", r_drv.text)
        self.assertIn("1972", r_drv.text)

        r_tm = self.sess.get(f"{self.base_url}/api/team/Mercedes-Benz", timeout=10)
        self.assertEqual(r_tm.status_code, 200)
        payload = r_tm.json()
        self.assertEqual(payload["team"], "Mercedes-Benz")
        self.assertGreater(len(payload["points_by_year"]), 0)
        self.assertGreater(len(payload["drivers"]), 0)

    def test_team_profile_active_year_span(self) -> None:
        r = self.sess.get(f"{self.base_url}/api/team/McLaren", timeout=10)
        self.assertEqual(r.status_code, 200)
        yr_range = r.json()["range"]
        self.assertIsNotNone(yr_range["first_year"])
        self.assertGreaterEqual(yr_range["first_year"], 1966)
        self.assertLessEqual(yr_range["last_year"], self.latest)

    def test_driver_edit_allows_half_points_and_404s_invalid_pos(self) -> None:
        r = self.sess.get(f"{self.base_url}/drivers/{self.latest}/edit/1", timeout=5)
        self.assertEqual(r.status_code, 200)
        self.assertIn('step="any"', r.text)

        self.assertEqual(self.sess.get(f"{self.base_url}/drivers/{self.latest}/edit/999", timeout=5).status_code, 404)
        self.assertEqual(self.sess.get(f"{self.base_url}/drivers/{self.latest}/row/999", timeout=5).status_code, 404)

    def test_pdf_routes_valid_and_parity(self) -> None:
        r_q = self.sess.get(f"{self.base_url}/cards.pdf?year={self.latest}", timeout=45)
        r_p = self.sess.get(f"{self.base_url}/cards/{self.latest}.pdf", timeout=45)
        self.assertEqual(r_q.status_code, 200)
        self.assertEqual(r_p.status_code, 200)
        self.assertTrue(r_q.content.startswith(b"%PDF-"))
        self.assertTrue(r_p.content.startswith(b"%PDF-"))
        self.assertAlmostEqual(len(r_q.content), len(r_p.content), delta=max(5000, len(r_q.content) * 0.05))

        r_dq = self.sess.get(f"{self.base_url}/cards/decade.pdf?decade=1980", timeout=45)
        r_dp = self.sess.get(f"{self.base_url}/cards/decade/1980.pdf", timeout=45)
        self.assertEqual(r_dq.status_code, 200)
        self.assertEqual(r_dp.status_code, 200)
        self.assertTrue(r_dq.content.startswith(b"%PDF-"))
        self.assertTrue(r_dp.content.startswith(b"%PDF-"))
        self.assertAlmostEqual(len(r_dq.content), len(r_dp.content), delta=max(5000, len(r_dq.content) * 0.05))

        r_all = self.sess.get(f"{self.base_url}/cards/alltime.pdf", timeout=60)
        self.assertEqual(r_all.status_code, 200)
        self.assertTrue(r_all.content.startswith(b"%PDF-"))
        self.assertGreater(len(r_all.content), 100_000)

        # Game Edition PDFs + Circuit & Weather Track Deck PDF
        r_game_s = self.sess.get(f"{self.base_url}/cards.pdf?year={self.latest}&mode=game", timeout=45)
        self.assertEqual(r_game_s.status_code, 200)
        self.assertTrue(r_game_s.content.startswith(b"%PDF-"))

        r_tracks = self.sess.get(f"{self.base_url}/cards/tracks.pdf", timeout=20)
        self.assertEqual(r_tracks.status_code, 200)
        self.assertTrue(r_tracks.content.startswith(b"%PDF-"))
        self.assertGreater(len(r_tracks.content), 5_000)

        # Per-driver & per-team full card deck PDFs + verified 1991 Nelson Piquet 26.5 pts fix!
        r_piq = self.sess.get(f"{self.base_url}/api/ratings/season/1991", timeout=20)
        self.assertEqual(r_piq.status_code, 200)
        piq_row = next((x for x in r_piq.json() if "Nelson Piquet" in x.get("driver", "")), None)
        self.assertIsNotNone(piq_row)
        self.assertAlmostEqual(float(piq_row["points"]), 26.5, places=1)
        self.assertEqual(r_piq.json()[0]["driver"], "Ayrton Senna SEN")

        r_dpdf = self.sess.get(f"{self.base_url}/driver/Nelson-Piquet-PIQ/cards.pdf?mode=collector", timeout=30)
        self.assertEqual(r_dpdf.status_code, 200)
        self.assertTrue(r_dpdf.content.startswith(b"%PDF-"))

        r_dpdf_yr = self.sess.get(f"{self.base_url}/driver/Nelson-Piquet-PIQ/cards.pdf?mode=game&year=1991", timeout=30)
        self.assertEqual(r_dpdf_yr.status_code, 200)
        self.assertTrue(r_dpdf_yr.content.startswith(b"%PDF-"))

        r_tpdf = self.sess.get(f"{self.base_url}/team/Benetton-Ford/cards.pdf?mode=collector", timeout=30)
        self.assertEqual(r_tpdf.status_code, 200)
        self.assertTrue(r_tpdf.content.startswith(b"%PDF-"))

    def test_win_and_fl_rates_use_driver_starts(self) -> None:
        db = srv_mod.get_db()
        alltime = db.driver_alltime_ratings()
        reu = next((r for r in alltime if "Reutemann" in r.get("driver", "")), None)
        self.assertIsNotNone(reu, "Expected Carlos Reutemann in all-time ratings")
        self.assertGreater(reu["starts"], 100)
        expected_win = round((reu["wins"] / reu["starts"]) * 100.0, 2)
        expected_fl = round((reu["fastest_laps"] / reu["starts"]) * 100.0, 2)
        self.assertAlmostEqual(reu["win_rate"], expected_win, places=1)
        self.assertAlmostEqual(reu["fl_rate"], expected_fl, places=1)
        self.assertGreater(reu["win_rate"], 5.0)
        self.assertLess(reu["fl_rate"], 10.0)

        dec_r = self.sess.get(f"{self.base_url}/api/ratings/decade/1980", timeout=20)
        self.assertEqual(dec_r.status_code, 200)
        dec_rows = dec_r.json()
        with_wins = [d for d in dec_rows if d.get("wins", 0) > 0 and d.get("starts", 0) > 0]
        self.assertTrue(with_wins)
        sample = with_wins[0]
        self.assertAlmostEqual(
            sample["win_rate"],
            round((sample["wins"] / sample["starts"]) * 100.0, 2),
            places=1,
        )


class TestIsolatedMutationRoutes(unittest.TestCase):
    """Test all POST endpoints against isolated temporary copies of DB and JSON files."""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        tmp = Path(self.tmpdir.name)
        self._orig_db = srv_mod.DATA_DB
        self._orig_colors_paths = list(srv_mod.TEAM_COLORS_PATHS)
        self._orig_colors = dict(srv_mod.TEAM_COLORS)
        self._orig_images_dir = srv_mod.DRIVER_IMAGES_DIR
        self._orig_career_base_dir = srv_mod._career_base_dir

        # Copy real sqlite DB to temp path so mutations never touch production data
        tmp_db = tmp / "f1.sqlite"
        shutil.copy2(self._orig_db, tmp_db)
        srv_mod.DATA_DB = tmp_db
        srv_mod.TEAM_COLORS_PATHS = [tmp / "team_colors.json"]
        srv_mod.TEAM_COLORS = dict(self._orig_colors)
        srv_mod.DRIVER_IMAGES_DIR = tmp / "driver_images"
        srv_mod._career_base_dir = lambda: tmp

        self.srv = _EmbeddedServer()
        self.srv.start()
        self.base_url = self.srv.base_url
        self.sess = requests.Session()

    def tearDown(self) -> None:
        self.sess.close()
        self.srv.stop()
        srv_mod.DATA_DB = self._orig_db
        srv_mod.TEAM_COLORS_PATHS = self._orig_colors_paths
        srv_mod.TEAM_COLORS = self._orig_colors
        srv_mod.DRIVER_IMAGES_DIR = self._orig_images_dir
        srv_mod._career_base_dir = self._orig_career_base_dir
        self.tmpdir.cleanup()

    def test_post_driver_standing_edit_fractional_points(self) -> None:
        r = self.sess.post(
            f"{self.base_url}/drivers/2025/edit/1",
            data={
                "driver": "Lando Norris NOR",
                "nationality": "GBR",
                "team": "McLaren",
                "points": "423.5",
                "driver_id": "",
            },
            timeout=10,
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("423.5", r.text)

    def test_post_driver_avatar_html_json_and_reset(self) -> None:
        # HTML form post redirects 303 back to profile
        r_html = self.sess.post(
            f"{self.base_url}/api/driver/Lando-Norris-NOR/avatar",
            data={"suit": "#112233", "helmet": "#445566", "accent": "#778899", "trim": "#aabbcc"},
            headers={"Accept": "text/html"},
            allow_redirects=False,
            timeout=10,
        )
        self.assertEqual(r_html.status_code, 303)
        self.assertEqual(r_html.headers.get("location"), "/driver/Lando-Norris-NOR")

        # JSON fetch post returns JSON
        r_json = self.sess.post(
            f"{self.base_url}/api/driver/Lando-Norris-NOR/avatar",
            data={"suit": "#223344", "helmet": "#556677", "accent": "#8899aa", "trim": "#bbccdd"},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        self.assertEqual(r_json.status_code, 200)
        self.assertTrue(r_json.json()["ok"])
        self.assertEqual(r_json.json()["avatar"]["suit"], "#223344")

        # Reset clears override
        r_rst = self.sess.post(
            f"{self.base_url}/api/driver/Lando-Norris-NOR/avatar",
            data={"reset": "1"},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        self.assertEqual(r_rst.status_code, 200)
        self.assertFalse(r_rst.json()["avatar"]["custom"])

    def test_post_driver_image_html_redirect_and_json(self) -> None:
        tiny_png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc`\x00\x00"
            b"\x00\x02\x00\x01\xe2!\xbc3\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        # Browser form submit redirects 303
        r_html = self.sess.post(
            f"{self.base_url}/api/driver/Lando-Norris-NOR/image",
            files={"file": ("test.png", tiny_png, "image/png")},
            headers={"Accept": "text/html"},
            allow_redirects=False,
            timeout=10,
        )
        self.assertEqual(r_html.status_code, 303)
        self.assertEqual(r_html.headers.get("location"), "/driver/Lando-Norris-NOR")

        # API client gets JSON
        r_json = self.sess.post(
            f"{self.base_url}/api/driver/Lando-Norris-NOR/image",
            files={"file": ("test.png", tiny_png, "image/png")},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        self.assertEqual(r_json.status_code, 200)
        self.assertTrue(r_json.json()["ok"])

    def test_post_team_colors_html_htmx_and_json(self) -> None:
        payload = {"primary": "#123456", "secondary": "#abcdef", "accent": "#fedcba"}
        # Browser form submit redirects 303 to /team/{team}
        r_html = self.sess.post(
            f"{self.base_url}/api/team/McLaren/colors",
            data=payload,
            headers={"Accept": "text/html"},
            allow_redirects=False,
            timeout=10,
        )
        self.assertEqual(r_html.status_code, 303)
        self.assertEqual(r_html.headers.get("location"), "/team/McLaren")

        # HTMX submit returns PlainTextResponse("Saved")
        r_hx = self.sess.post(
            f"{self.base_url}/api/team/McLaren/colors",
            data=payload,
            headers={"HX-Request": "true"},
            timeout=10,
        )
        self.assertEqual(r_hx.status_code, 200)
        self.assertEqual(r_hx.text, "Saved")

        # API client receives JSON
        r_json = self.sess.post(
            f"{self.base_url}/api/team/Mercedes-Benz/colors",
            data=payload,
            headers={"Accept": "application/json"},
            timeout=10,
        )
        self.assertEqual(r_json.status_code, 200)
        js = r_json.json()
        self.assertTrue(js["ok"])
        self.assertEqual(js["team"], "Mercedes-Benz")

    def test_career_season_lifecycle(self) -> None:
        # Career page loads cleanly
        r_page = self.sess.get(f"{self.base_url}/career", timeout=15)
        self.assertEqual(r_page.status_code, 200)
        self.assertIn("Build Your Formula 1 Dynasty", r_page.text)

        # Create a new 8-round 2026 career
        r_new = self.sess.post(
            f"{self.base_url}/api/career/new",
            json={"era": "2026", "team_choice": "Ferrari", "calendar_len": "8"},
            timeout=20,
        )
        self.assertEqual(r_new.status_code, 200)
        d = r_new.json()
        self.assertTrue(d["ok"])
        self.assertTrue(d["has_career"])
        self.assertEqual(len(d["state"]["calendar"]), 8)
        self.assertGreaterEqual(len(d["state"]["drivers"]), 24)

        # Upgrade facility, start R&D, assign express scout, sign sponsor
        r_fac = self.sess.post(f"{self.base_url}/api/career/facility/upgrade", json={"facility_id": "pit_sim"}, timeout=10)
        self.assertTrue(r_fac.json()["ok"])

        r_rd = self.sess.post(f"{self.base_url}/api/career/rd/start", json={"part_id": "aero", "mode": "normal"}, timeout=10)
        self.assertTrue(r_rd.json()["ok"])

        unscouted = [drv for drv in d["state"]["drivers"].values() if not drv["scouted"]]
        self.assertTrue(unscouted)
        r_sc = self.sess.post(
            f"{self.base_url}/api/career/scout/assign",
            json={"driver_id": unscouted[0]["id"], "express": True},
            timeout=10,
        )
        self.assertTrue(r_sc.json()["ok"])

        r_sp = self.sess.post(f"{self.base_url}/api/career/sponsor/sign", json={"sponsor_id": "veloce_watch"}, timeout=10)
        self.assertTrue(r_sp.json()["ok"])

        # F1 Manager V2: Staff hiring, Driver Dev Focus, Next-Gen Research, Paddock Dilemma & FP Car Setup!
        staff_mkt = r_sp.json()["state"]["staff_market"]
        self.assertTrue(staff_mkt)
        r_st = self.sess.post(f"{self.base_url}/api/career/staff/hire", json={"candidate_id": staff_mkt[0]["id"]}, timeout=10)
        self.assertTrue(r_st.json()["ok"])

        lead_drv = r_st.json()["player_team"]["driver_ids"][0]
        r_foc = self.sess.post(f"{self.base_url}/api/career/driver/focus", json={"driver_id": lead_drv, "focus": "wet"}, timeout=10)
        self.assertTrue(r_foc.json()["ok"])

        r_ng = self.sess.post(f"{self.base_url}/api/career/rd/nextgen", json={"part_id": "aero"}, timeout=10)
        self.assertTrue(r_ng.json()["ok"])
        self.assertGreater(r_ng.json()["state"]["next_gen_research"]["aero"], 0.0)

        self.assertIsNotNone(r_ng.json()["state"].get("pending_dilemma"))
        r_dil = self.sess.post(f"{self.base_url}/api/career/dilemma/resolve", json={"choice_idx": 0}, timeout=10)
        self.assertTrue(r_dil.json()["ok"])
        self.assertIsNone(r_dil.json()["state"]["pending_dilemma"])

        r_fp = self.sess.post(f"{self.base_url}/api/career/race/setup", json={"wing": 55, "susp": 55, "diff": 55, "auto": True}, timeout=10)
        self.assertTrue(r_fp.json()["ok"])
        self.assertGreaterEqual(r_fp.json()["weekend_setup"]["confidence"], 70)

        # Qualify + Quick-Sim Round 1 and confirm Round advances, WCC history recorded & points awarded
        r_q = self.sess.post(f"{self.base_url}/api/career/race/qualify", json={"weather_mode": "dynamic"}, timeout=10)
        self.assertTrue(r_q.json()["ok"])
        self.assertGreaterEqual(len(r_q.json()["quali"]["grid"]), 18)

        r_sim = self.sess.post(f"{self.base_url}/api/career/race/quicksim", json={"weather_mode": "dynamic"}, timeout=10)
        sim_js = r_sim.json()
        self.assertTrue(sim_js["ok"])
        self.assertEqual(sim_js["state"]["current_round"], 2)
        self.assertTrue(sim_js["state"]["calendar"][0]["completed"])
        self.assertEqual(len(sim_js["state"]["wcc_history"]), 1)

        # Permanent Grand Prix Race Report stored in SQLite for S1 R1!
        r_rep = self.sess.get(f"{self.base_url}/api/career/race/report/1/1", timeout=10)
        self.assertEqual(r_rep.status_code, 200)
        rep = r_rep.json()["report"]
        self.assertEqual(rep["round_num"], 1)
        self.assertGreaterEqual(len(rep["classification"]), 18)
        self.assertIn("rating", rep["classification"][0])

        # Q1 -> Q2 -> Q3 Knockout Qualifying + Scrubbed Softs bonus
        r_q1 = self.sess.post(f"{self.base_url}/api/career/race/qualify", json={"stage": "q1", "tyre_choice": "scrubbed"}, timeout=10)
        self.assertEqual(r_q1.json()["quali"]["stage"], "q1_done")
        self.assertTrue(r_q1.json()["quali"]["saved_fresh_soft"])
        r_q2 = self.sess.post(f"{self.base_url}/api/career/race/qualify", json={"stage": "q2", "tyre_choice": "fresh"}, timeout=10)
        self.assertEqual(r_q2.json()["quali"]["stage"], "q2_done")
        r_q3 = self.sess.post(f"{self.base_url}/api/career/race/qualify", json={"stage": "q3", "tyre_choice": "fresh"}, timeout=10)
        self.assertEqual(r_q3.json()["quali"]["stage"], "done")

        # Mid-race autosave & clear
        r_as = self.sess.post(
            f"{self.base_url}/api/career/race/autosave",
            json={"snapshot": {"season_num": 1, "round_num": 2, "circuit_id": "monaco", "lap": 5, "total_laps": 15, "cars": []}},
            timeout=10,
        )
        self.assertTrue(r_as.json()["ok"])
        slots_info = self.sess.get(f"{self.base_url}/api/career/slots", timeout=10).json()
        self.assertIsNotNone(slots_info["midrace"])
        self.assertEqual(slots_info["midrace"]["lap"], 5)
        self.assertEqual(self.sess.delete(f"{self.base_url}/api/career/race/autosave", timeout=10).status_code, 200)

        # Strict Pydantic v2 validation rejects malformed payloads with 422
        r_bad = self.sess.post(f"{self.base_url}/api/career/pu/swap", json={"car_num": 9, "component": "ice"}, timeout=10)
        self.assertEqual(r_bad.status_code, 422)

        # Contract renewal for player's lead driver
        r_ren = self.sess.post(
            f"{self.base_url}/api/career/driver/renew",
            json={"driver_id": lead_drv, "salary_m": 25.0, "years": 2},
            timeout=10,
        )
        self.assertEqual(r_ren.status_code, 200)
        self.assertTrue(r_ren.json()["ok"])

        # Multi-Slot Save Manager: Duplicate, Rename, Switch, Export/Import, Checkpoint Rollback, Delete
        slot1 = slots_info["active_slot_id"]
        ckpts = slots_info["checkpoints"]
        self.assertTrue(ckpts)

        r_dup = self.sess.post(f"{self.base_url}/api/career/slots/duplicate", json={"slot_id": slot1, "slot_name": "Ferrari Copy"}, timeout=10)
        self.assertTrue(r_dup.json()["ok"])
        slot2 = r_dup.json()["slot_id"]
        self.assertNotEqual(slot1, slot2)

        r_ren_s = self.sess.post(f"{self.base_url}/api/career/slots/rename", json={"slot_id": slot2, "slot_name": "Scuderia Backup"}, timeout=10)
        self.assertTrue(r_ren_s.json()["ok"])

        r_exp = self.sess.get(f"{self.base_url}/api/career/export", timeout=10)
        self.assertEqual(r_exp.status_code, 200)
        backup_json = r_exp.json()
        self.assertEqual(backup_json["format"], "local-f1-career-backup-v1")

        r_imp = self.sess.post(f"{self.base_url}/api/career/import", json={"backup": backup_json, "slot_name": "Imported Slot"}, timeout=10)
        self.assertTrue(r_imp.json()["ok"])

        r_sw = self.sess.post(f"{self.base_url}/api/career/slots/switch", json={"slot_id": slot1}, timeout=10)
        self.assertTrue(r_sw.json()["ok"])

        r_rb = self.sess.post(f"{self.base_url}/api/career/checkpoint/restore", json={"checkpoint_id": ckpts[-1]["checkpoint_id"]}, timeout=10)
        self.assertTrue(r_rb.json()["ok"])

        r_del = self.sess.post(f"{self.base_url}/api/career/slots/delete", json={"slot_id": slot2}, timeout=10)
        self.assertTrue(r_del.json()["ok"])

        # Unified Player Profile & 20-Achievement Trophy Cabinet (/play + /career)
        # Team Livery Designer + Youth Academy Train & F2 Wonderkid Discovery!
        r_liv = self.sess.post(
            f"{self.base_url}/api/career/team/livery",
            json={"palette": {"main": "#00d2be", "secondary": "#111622", "accent": "#facc15", "pop": "#ffffff", "detail": "#1e293b"}, "livery_style": "chevron", "car_era": "1980s"},
            timeout=10,
        )
        self.assertTrue(r_liv.json()["ok"])
        self.assertEqual(r_liv.json()["player_team"]["car_era"], "1980s")

        r_at = self.sess.post(f"{self.base_url}/api/career/academy/train", timeout=10)
        self.assertTrue(r_at.json()["ok"])

        r_ad = self.sess.post(f"{self.base_url}/api/career/academy/discover", timeout=10)
        self.assertTrue(r_ad.json()["ok"])

        # Post-Race Press Conference & Rivalry Heat + Dynasty Totals + Custom Career Team PDF Export!
        r_qs2 = self.sess.post(f"{self.base_url}/api/career/race/quicksim", json={"weather_mode": "dry"}, timeout=15)
        self.assertEqual(r_qs2.status_code, 200)
        qs2 = r_qs2.json()
        self.assertTrue(qs2["ok"])
        self.assertIsNotNone(qs2["state"].get("pending_media"))
        self.assertGreaterEqual(qs2["state"]["dynasty"]["races"], 1)

        r_med = self.sess.post(f"{self.base_url}/api/career/media/respond", json={"choice_idx": 1}, timeout=10)
        self.assertEqual(r_med.status_code, 200)
        med = r_med.json()
        self.assertTrue(med["ok"])
        self.assertIsNone(med["state"].get("pending_media"))
        self.assertGreaterEqual(len(med["state"].get("rivalries") or []), 1)

        r_cpdf = self.sess.get(f"{self.base_url}/career/cards.pdf?mode=collector", timeout=30)
        self.assertEqual(r_cpdf.status_code, 200)
        self.assertTrue(r_cpdf.content.startswith(b"%PDF-"))
        self.assertGreater(len(r_cpdf.content), 4000)

        r_gpdf = self.sess.get(f"{self.base_url}/career/cards.pdf?mode=game", timeout=30)
        self.assertEqual(r_gpdf.status_code, 200)
        self.assertTrue(r_gpdf.content.startswith(b"%PDF-"))

        for _ in range(3):
            self.sess.post(f"{self.base_url}/api/profile/event", json={"event_type": "card_battle", "payload": {"won": True}}, timeout=5)
        self.sess.post(f"{self.base_url}/api/profile/event", json={"event_type": "track_sim", "payload": {"pos": 1, "is_wet": True}}, timeout=5)
        prof = self.sess.get(f"{self.base_url}/api/profile", timeout=5).json()
        self.assertTrue(prof["ok"])
        unlocked_ids = {a["id"] for a in prof["achievements"] if a["unlocked"]}
        self.assertIn("lights_out", unlocked_ids)
        self.assertIn("card_duelist", unlocked_ids)
        self.assertIn("hot_streak", unlocked_ids)
        self.assertIn("sim_strategist", unlocked_ids)
        self.assertIn("rain_master", unlocked_ids)

        # Wave 1/2 Security + Concurrency + Economy checks
        # 1. Disallow SVG/HTML upload & invalid hex colours
        r_svg = self.sess.post(
            f"{self.base_url}/api/driver/Lando-Norris-NOR/image",
            files={"file": ("xss.svg", b"<svg onload=alert(1)></svg>", "image/svg+xml")},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        self.assertEqual(r_svg.status_code, 400)

        r_badhex = self.sess.post(
            f"{self.base_url}/api/team/McLaren/colors",
            data={"primary": "red;evil", "secondary": "#abcdef", "accent": "#fedcba"},
            headers={"Accept": "application/json"},
            timeout=10,
        )
        self.assertEqual(r_badhex.status_code, 400)

        # 2. Slimmed Career POST mutations omit heavy circuits payload
        r_slim = self.sess.post(
            f"{self.base_url}/api/career/driver/focus",
            json={"driver_id": lead_drv, "focus": "pace"},
            timeout=10,
        )
        self.assertEqual(r_slim.status_code, 200)
        self.assertNotIn("circuits", r_slim.json())

        # 3. Optimistic concurrency rejects stale expected_version with 409 Conflict
        r_stale = self.sess.post(
            f"{self.base_url}/api/career/driver/focus",
            json={"driver_id": lead_drv, "focus": "balanced", "expected_version": 1},
            timeout=10,
        )
        self.assertEqual(r_stale.status_code, 409)

        # 4. Parc Fermé locks both manual AND auto FP setup after 3 stints
        for _ in range(3):
            self.sess.post(f"{self.base_url}/api/career/race/setup", json={"wing": 50, "susp": 50, "diff": 50, "auto": False}, timeout=10)
        r_pf_auto = self.sess.post(f"{self.base_url}/api/career/race/setup", json={"wing": 50, "susp": 50, "diff": 50, "auto": True}, timeout=10)
        self.assertEqual(r_pf_auto.status_code, 200)
        self.assertFalse(r_pf_auto.json()["ok"])

        # 5. Debrief includes Technical Staff Payroll deduction
        self.assertGreater(qs2["debrief"].get("staff_per_race_m", 0), 0.0)

        # 6. FIA Soft Cost Cap breach applies fine & R&D nerf when overspending cap
        from f1data import career as _career_mod
        st_cap = _career_mod.load_career(Path(self.tmpdir.name))
        st_cap["cash_m"] = 250.0
        st_cap["cost_cap_spent_m"] = 134.0
        _career_mod._log_finance(st_cap, "Test Minor Overspend", -3.0, cap_eligible=True)
        self.assertEqual(st_cap["cost_cap_breach_tier"], "minor")
        self.assertAlmostEqual(st_cap["rd_nerf_mult"], 0.85, places=2)
        _career_mod._log_finance(st_cap, "Test Material Overspend", -10.0, cap_eligible=True)
        self.assertEqual(st_cap["cost_cap_breach_tier"], "material")
        self.assertAlmostEqual(st_cap["rd_nerf_mult"], 0.75, places=2)
        self.assertEqual(st_cap["next_season_cap_penalty_m"], 10.0)


if __name__ == "__main__":
    unittest.main()
