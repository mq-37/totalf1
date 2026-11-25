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
    def test_red_bull_2026_gloss_cobalt_and_2024_matte_navy(self):
        spec26 = livery_registry.resolve_team_livery("Red Bull Racing", 2026)
        self.assertEqual(spec26["style"], "redbull")
        self.assertEqual(spec26["finish"], "gloss")
        self.assertEqual(spec26["motif"], "bull_nose")
        self.assertEqual(spec26["palette"]["main"].upper(), "#0B2168")
        self.assertEqual(spec26["palette"]["accent"].upper(), "#FFBE00")
        self.assertEqual(spec26["palette"]["secondary"].upper(), "#E00A2B")

        spec24 = livery_registry.resolve_team_livery("Red Bull Racing", 2024)
        self.assertEqual(spec24["style"], "redbull")
        self.assertEqual(spec24["finish"], "matte")
        self.assertEqual(spec24["palette"]["main"].upper(), "#0B1A3C")

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
        s24 = livery_registry.resolve_team_livery("Mercedes", 2024)
        s16 = livery_registry.resolve_team_livery("Mercedes", 2016)
        self.assertEqual(s26["style"], "merc_arrow")
        self.assertEqual(s26["finish"], "gloss")
        self.assertEqual(s26["palette"]["main"].upper(), "#0F1319")
        self.assertEqual(s26["palette"]["secondary"].upper(), "#C8CCCE")
        self.assertEqual(s26["palette"]["accent"].upper(), "#00D2BE")
        self.assertEqual(s24["palette"]["pop"].upper(), "#E10600")
        self.assertEqual(s16["palette"]["main"].upper(), "#C8CCCE")

    def test_new_2026_entries_and_historic_mclaren(self):
        audi = livery_registry.resolve_team_livery("Audi", 2026)
        cad = livery_registry.resolve_team_livery("Cadillac", 2026)
        vcarb = livery_registry.resolve_team_livery("Racing Bulls", 2026)
        williams = livery_registry.resolve_team_livery("Williams", 2026)
        wil24 = livery_registry.resolve_team_livery("Williams", 2024)
        wil16 = livery_registry.resolve_team_livery("Williams", 2016)
        mac26 = livery_registry.resolve_team_livery("McLaren", 2026)
        mac88 = livery_registry.resolve_team_livery("McLaren", 1988)
        jps79 = livery_registry.resolve_team_livery("Lotus", 1979)
        brawn09 = livery_registry.resolve_team_livery("Brawn", 2009)
        aston26 = livery_registry.resolve_team_livery("Aston Martin", 2026)
        self.assertEqual(audi["style"], "audi_slash")
        self.assertEqual(cad["style"], "cadillac_split")
        self.assertEqual(vcarb["style"], "vcarb_2026")
        self.assertEqual(williams["style"], "williams_2026")
        self.assertEqual(wil24["style"], "williams_duracell")
        self.assertEqual(wil16["style"], "martini_tri")
        self.assertEqual(mac26["style"], "mclaren_papaya")
        self.assertEqual(mac88["style"], "mclaren_marlboro")
        self.assertEqual(mac88["palette"]["main"].upper(), "#F8FAFC")
        self.assertEqual(jps79["style"], "lotus_jps")
        self.assertEqual(brawn09["style"], "brawn_neon")
        self.assertEqual(aston26["style"], "aston_wings")

    def test_gold_leaf_lotus_1968_1971_split_from_brg(self):
        """1968-71 Gold Leaf metallic gold/red era vs 1967 BRG green debut & 1972+ JPS."""
        gl68 = livery_registry.resolve_team_livery("Lotus Ford", 1968)
        gl70 = livery_registry.resolve_team_livery("Lotus Ford", 1970)
        debut67 = livery_registry.resolve_team_livery("Lotus Ford", 1967)
        brm63 = livery_registry.resolve_team_livery("Lotus BRM", 1963)
        self.assertEqual(gl68["style"], "lotus_gold_leaf")
        self.assertEqual(gl68["finish"], "metallic")
        self.assertEqual(gl68["motif"], "gold_leaf")
        self.assertEqual(gl68["palette"]["main"].upper(), "#C9A227")
        self.assertEqual(gl68["palette"]["secondary"].upper(), "#E10600")
        self.assertEqual(gl70["style"], "lotus_gold_leaf")
        self.assertEqual(debut67["style"], "classic")
        self.assertEqual(debut67["palette"]["main"].upper(), "#005936")
        self.assertEqual(brm63["style"], "classic")

    def test_ferrari_white_deck_126c2_turbo_era_1982_1985(self):
        """1982-85 Marlboro turbo 126C2/C3: red tub + white upper deck; 1980-81 stay classic."""
        s82 = livery_registry.resolve_team_livery("Ferrari", 1982)
        s84 = livery_registry.resolve_team_livery("Ferrari", 1984)
        s81 = livery_registry.resolve_team_livery("Ferrari", 1981)
        self.assertEqual(s82["style"], "ferrari_white_deck")
        self.assertEqual(s82["palette"]["main"].upper(), "#DC0000")
        self.assertEqual(s82["palette"]["secondary"].upper(), "#FFFFFF")
        self.assertEqual(s84["style"], "ferrari_white_deck")
        self.assertEqual(s81["style"], "classic")

    def test_sauber_era_resolution_red_petronas_to_kick_green(self):
        """Sauber eras: 1994-2000 red/white Petronas, 2001-05 blue/teal Red Bull, 2006-09 BMW,
        2010-18 graphite, 2024-25 Kick neon green."""
        red99 = livery_registry.resolve_team_livery("Sauber Petronas", 1999)
        c12_93 = livery_registry.resolve_team_livery("Sauber", 1993)
        rb01 = livery_registry.resolve_team_livery("Sauber Petronas", 2001)
        rb04 = livery_registry.resolve_team_livery("Sauber Petronas", 2004)
        bmw07 = livery_registry.resolve_team_livery("Sauber BMW", 2007)
        bmw05 = livery_registry.resolve_team_livery("Sauber BMW", 2005)
        fer12 = livery_registry.resolve_team_livery("Sauber Ferrari", 2012)
        fer10 = livery_registry.resolve_team_livery("Sauber Ferrari", 2010)
        kick24 = livery_registry.resolve_team_livery("Kick Sauber Ferrari", 2024)
        self.assertEqual(c12_93["style"], "carbon_stealth")
        self.assertEqual(c12_93["palette"]["main"].upper(), "#0C0D0F")
        self.assertEqual(red99["style"], "ferrari_white_deck")
        self.assertEqual(red99["palette"]["main"].upper(), "#C8102E")
        self.assertEqual(rb01["style"], "sauber_petronas")
        self.assertEqual(rb01["palette"]["main"].upper(), "#1530B8")
        self.assertEqual(rb01["palette"]["secondary"].upper(), "#3EC6C0")
        self.assertEqual(rb04["style"], "sauber_petronas")
        self.assertEqual(bmw07["style"], "two-tone")
        self.assertEqual(bmw07["palette"]["main"].upper(), "#F5F7FA")
        # Team-keyed BMW identity must never bleed into the Petronas era, even at y=2005!
        self.assertEqual(bmw05["palette"]["main"].upper(), "#F5F7FA")
        # 2010 C29 kept the BMW white/blue carry-over; 2012 went graphite
        self.assertEqual(fer10["palette"]["main"].upper(), "#F5F7FA")
        self.assertEqual(fer12["style"], "two-tone")
        self.assertEqual(fer12["palette"]["main"].upper(), "#1A2237")
        self.assertEqual(kick24["style"], "carbon_stealth")
        self.assertEqual(kick24["palette"]["secondary"].upper(), "#3BFF9E")
        # Engine-suffixed team names must resolve to the constructor, NOT the PU supplier!
        self.assertEqual(livery_registry.resolve_team_livery("McLaren Mercedes", 2026)["style"], "mclaren_papaya")
        self.assertEqual(livery_registry.resolve_team_livery("Aston Martin Aramco Mercedes", 2026)["style"], "aston_wings")
        self.assertEqual(livery_registry.resolve_team_livery("Williams Mercedes", 2016)["style"], "martini_tri")
        self.assertEqual(livery_registry.resolve_team_livery("Haas Ferrari", 2026)["style"], "haas_tgr")
        self.assertEqual(livery_registry.resolve_team_livery("Haas Ferrari", 2024)["style"], "haas_carbon")
        self.assertEqual(livery_registry.resolve_team_livery("Haas Ferrari", 2019)["style"], "lotus_jps")
        self.assertEqual(livery_registry.resolve_team_livery("Brawn Mercedes", 2009)["style"], "brawn_neon")


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
