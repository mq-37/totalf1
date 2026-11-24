"""
Verification suite for Plan v2:
  1. Per-Year Authentic Liveries, Paint Finishes & Signature 3D Livery Styles (1950–2026).
  2. FIA Regulation Architect, CAD Dimensions Physics Engine, Custom Car Tools & Grouped Shared Formula Library.
  3. Data-Deduced Team Principal, Race Engineer & Driver Profiles, F1 Commission Voting & Realistic Job-Stress Engine.
  4. FastAPI HTTP endpoints & Career backwards-compatibility.
"""
from __future__ import annotations

import copy
import socket
import threading
import time
import unittest

import requests
import uvicorn

from f1data import career_extras, livery_registry, paddock_profiles, regulation_architect
from f1data.server import app


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestLiveryRegistry(unittest.TestCase):
    def test_red_bull_2026_matte_yellow_nose_crimson_bull(self):
        spec = livery_registry.resolve_team_livery("Red Bull Racing", 2026)
        self.assertEqual(spec["style"], "redbull")
        self.assertEqual(spec["finish"], "matte")
        self.assertEqual(spec["motif"], "bull_nose")
        self.assertEqual(spec["palette"]["main"].upper(), "#0B1A3C")
        self.assertEqual(spec["palette"]["accent"].upper(), "#FFCC00")
        self.assertEqual(spec["palette"]["secondary"].upper(), "#DB0A40")

    def test_ferrari_year_evolution_2025_2026_hp_blue_and_white(self):
        s26 = livery_registry.resolve_team_livery("Ferrari", 2026)
        s25 = livery_registry.resolve_team_livery("Scuderia Ferrari", 2025)
        s04 = livery_registry.resolve_team_livery("Ferrari", 2004)
        self.assertEqual(s26["style"], "ferrari_hp")
        self.assertEqual(s26["palette"]["main"].upper(), "#DC0000")
        self.assertEqual(s26["palette"]["secondary"].upper(), "#FFFFFF")
        self.assertEqual(s26["palette"]["accent"].upper(), "#0052B4")
        self.assertEqual(s25["style"], "ferrari_hp")
        self.assertEqual(s04["style"], "two-tone")

    def test_mercedes_carbon_silver_arrow_petronas_teal(self):
        s26 = livery_registry.resolve_team_livery("Mercedes", 2026)
        s16 = livery_registry.resolve_team_livery("Mercedes", 2016)
        self.assertEqual(s26["style"], "merc_arrow")
        self.assertEqual(s26["finish"], "metallic")
        self.assertEqual(s26["palette"]["main"].upper(), "#11151B")
        self.assertEqual(s26["palette"]["secondary"].upper(), "#C8CCCE")
        self.assertEqual(s26["palette"]["accent"].upper(), "#27F4D2")
        self.assertEqual(s16["palette"]["main"].upper(), "#C8CCCE")

    def test_new_2026_entries_and_historic_mclaren(self):
        audi = livery_registry.resolve_team_livery("Audi", 2026)
        cad = livery_registry.resolve_team_livery("Cadillac", 2026)
        williams = livery_registry.resolve_team_livery("Williams", 2026)
        mac88 = livery_registry.resolve_team_livery("McLaren", 1988)
        self.assertEqual(audi["style"], "audi_slash")
        self.assertEqual(cad["style"], "cadillac_split")
        self.assertEqual(williams["style"], "williams_duracell")
        self.assertEqual(mac88["style"], "chevron")
        self.assertEqual(mac88["palette"]["main"].upper(), "#F8FAFC")


class TestRegulationArchitect(unittest.TestCase):
    def test_custom_car_tool_creation_and_physics_evaluation(self):
        tool = regulation_architect.create_custom_tool(
            name="Vortex DRS",
            short_code="VORTEX",
            trigger="within_1s",
            aero_mode="drag_cut",
            power_mode="ers_overboost",
            intensity=1.2,
            side_effect="tyre_wear",
        )
        self.assertEqual(tool["short"], "VORTEX")
        self.assertGreater(tool["effects"]["top_speed_kph"], 15.0)
        self.assertGreater(tool["effects"]["tyre_deg"], 0.05)

        f = copy.deepcopy(regulation_architect.DEFAULT_2026_FORMULA)
        f["custom_tools"] = [tool]
        f["active_tools"] = ["active_aero", "fan_car", tool["id"]]
        f["dimensions"]["min_weight_kg"] = 660
        ev = regulation_architect.evaluate_formula_physics(f)
        self.assertIn("VORTEX", ev["active_tool_badges"])
        self.assertIn("FAN-CAR", ev["active_tool_badges"])
        self.assertGreater(ev["metrics"]["cornering_index"], 82.0)
        self.assertLess(ev["metrics"]["lap_time_delta_s"], 0.0)


class TestPaddockPoliticsAndStress(unittest.TestCase):
    def test_commission_voting_respects_self_interest_and_lobbying(self):
        roster = paddock_profiles.initial_tp_roster()
        self.assertEqual(len(roster), 11)
        f = copy.deepcopy(regulation_architect.DEFAULT_2026_FORMULA)
        f["name"] = "2028 Cost-Cap Parity & Active Aero"
        f["governance"]["cost_cap_m"] = 135
        ev = regulation_architect.evaluate_formula_physics(f)

        base_vote = paddock_profiles.evaluate_commission_bill(roster, ev, lobbied_tp_ids=[])
        lob_ids = [tp["id"] for tp in roster[:5]]
        lobbied_vote = paddock_profiles.evaluate_commission_bill(roster, ev, lobbied_tp_ids=lob_ids)
        self.assertGreaterEqual(lobbied_vote["yes_count"], base_vote["yes_count"])
        self.assertTrue(all(v["quote"] for v in base_vote["votes"]))

    def test_realistic_executive_transition_on_sustained_underperformance(self):
        roster = paddock_profiles.initial_tp_roster()
        # Simulate Ferrari (target P1) finishing P10 for consecutive seasons
        bad_order = ["McLaren", "Mercedes", "Red Bull Racing", "Williams", "Aston Martin", "Haas", "Alpine", "Audi", "Racing Bulls", "Ferrari", "Cadillac"]
        events_all = []
        for _ in range(4):
            res = paddock_profiles.step_paddock_stress(roster, bad_order, season_end=True)
            events_all.extend(res["events"])
        self.assertTrue(
            any(e["team"] == "Ferrari" and e["type"] == "executive_transition" for e in events_all),
            "Sustained multi-season underperformance should trigger a realistic executive transition",
        )
        # Ensure wording stays professional/realistic (no unprofessional freakouts)
        for ev in events_all:
            self.assertIn("board performance review", ev["headline"].lower())

    def test_season_paddock_bundle_historical_and_modern(self):
        b26 = paddock_profiles.get_season_paddock_bundle(2026)
        b88 = paddock_profiles.get_season_paddock_bundle(1988)
        self.assertEqual(len(b26["team_principals"]), 11)
        self.assertTrue(any(tp["name"] == "Ron Dennis" for tp in b88["team_principals"]))
        self.assertGreaterEqual(len(b26["race_engineers"]), 6)


class TestHttpEndpointsV2(unittest.TestCase):
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

    def test_livery_and_paddock_and_regulation_endpoints(self):
        r1 = requests.get(f"{self.base_url}/api/cars/livery?team=Ferrari&year=2026", timeout=5)
        self.assertEqual(r1.status_code, 200)
        d1 = r1.json()
        self.assertEqual(d1["style"], "ferrari_hp")
        self.assertEqual(d1["palette"]["accent"].upper(), "#0052B4")

        r2 = requests.get(f"{self.base_url}/api/regulations/architect", timeout=5)
        self.assertEqual(r2.status_code, 200)
        d2 = r2.json()
        self.assertIn("official_eras", d2)
        self.assertIn("custom_voted_formulas", d2)
        self.assertGreaterEqual(len(d2["tools_catalog"]), 10)

        r3 = requests.post(
            f"{self.base_url}/api/regulations/tool/create",
            json={"name": "Aero-Slot X", "short_code": "SLOTX", "aero_mode": "wake_cleaner", "power_mode": "ers_overboost"},
            timeout=5,
        )
        self.assertEqual(r3.status_code, 200)
        self.assertEqual(r3.json()["tool"]["short"], "SLOTX")

        r4 = requests.get(f"{self.base_url}/api/paddock/profiles?year=2026", timeout=5)
        self.assertEqual(r4.status_code, 200)
        self.assertEqual(len(r4.json()["team_principals"]), 11)

        r5 = requests.get(f"{self.base_url}/sim", timeout=5)
        self.assertEqual(r5.status_code, 200)
        self.assertIn("Official FIA Eras", r5.text)
        self.assertIn("Custom Voted Formulas", r5.text)


if __name__ == "__main__":
    unittest.main()
