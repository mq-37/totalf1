"""Unit & API tests for the F1DB + FIA-Docs Fair Rating & Attribute Engine."""
from __future__ import annotations

import unittest
import f1data.server  # noqa: F401 (initialize routers cleanly)
from f1data.rating_engine import compute_fair_attributes, lookup_f1db_driver_metrics
from f1data.game import BATTLE_STATS, compute_game_profile
from f1data.routers.game import api_game_deck, api_fair_driver_rating


def _stub_card(name: str, wins: int = 0, podiums: int = 0, starts: int = 100,
               championships: int = 0, overall: float = 75.0, hero_team: str = "Ferrari") -> dict:
    return {
        "driver": name,
        "clean_name": name,
        "wins": wins,
        "podiums": podiums,
        "starts": starts,
        "fastest_laps": max(0, wins // 2),
        "championships": championships,
        "win_rate": round((wins / max(1, starts)) * 100.0, 2),
        "podium_rate": round((podiums / max(1, starts)) * 100.0, 2),
        "dnf_rate": 15.0,
        "avg_finish": 6.5,
        "overall": overall,
        "hero_team": hero_team,
    }


class TestFairRatingEngine(unittest.TestCase):
    def test_f1db_index_loads_and_resolves_jr_suffix(self):
        m_senna = lookup_f1db_driver_metrics("Ayrton Senna")
        self.assertIsNotNone(m_senna)
        self.assertGreater(m_senna["starts"], 150)

        sainz = compute_fair_attributes(_stub_card("Carlos Sainz", wins=4, podiums=27, starts=206, overall=82.0))
        tel = sainz["telemetry"]
        self.assertIsNotNone(tel["quali_h2h_pct"], "Carlos Sainz should resolve to Carlos Sainz Jr. in F1DB")
        self.assertIsNotNone(tel["race_h2h_pct"])
        self.assertGreater(tel["quali_h2h_pct"], 40.0)
        self.assertGreater(tel["race_h2h_pct"], 40.0)

    def test_mechanical_vs_driver_fault_dnf_separation(self):
        # Ayrton Senna & Alain Prost raced in high-mechanical-attrition turbo/early-90s eras
        senna = compute_fair_attributes(_stub_card("Ayrton Senna", wins=41, podiums=80, starts=161, championships=3, overall=94.0, hero_team="McLaren"))
        prost = compute_fair_attributes(_stub_card("Alain Prost", wins=51, podiums=106, starts=199, championships=4, overall=94.0, hero_team="McLaren"))
        alonso = compute_fair_attributes(_stub_card("Fernando Alonso", wins=32, podiums=106, starts=401, championships=2, overall=88.0, hero_team="Aston Martin"))

        self.assertGreater(senna["telemetry"]["mech_dnf_pct"], 18.0)
        self.assertLess(senna["stats"]["dnf_rate"], 12.0, "Senna's driver-fault DNF must exclude mechanical failures")
        self.assertGreater(prost["telemetry"]["mech_dnf_pct"], 18.0)
        self.assertLess(prost["stats"]["dnf_rate"], 10.0)
        self.assertGreater(alonso["telemetry"]["mech_dnf_pct"], 10.0)
        self.assertLess(alonso["stats"]["dnf_rate"], 7.0, "Alonso's driver-fault DNF should be elite low")
        self.assertGreater(alonso["telemetry"]["avg_pos_gained"], 0.8)

    def test_fair_overall_ordering_and_8_attributes(self):
        self.assertEqual(len(BATTLE_STATS), 8)
        stat_keys = {s["key"] for s in BATTLE_STATS}
        for req in ("pace", "racecraft", "reliability", "duels", "clutch", "wet", "tyre_care", "dnf_rate"):
            self.assertIn(req, stat_keys)

        ver = compute_fair_attributes(_stub_card("Max Verstappen", wins=63, podiums=112, starts=209, championships=4, overall=95.0, hero_team="Red Bull"))
        ham = compute_fair_attributes(_stub_card("Lewis Hamilton", wins=105, podiums=202, starts=356, championships=7, overall=96.0, hero_team="Mercedes"))
        sen = compute_fair_attributes(_stub_card("Ayrton Senna", wins=41, podiums=80, starts=161, championships=3, overall=94.0, hero_team="McLaren"))
        alo = compute_fair_attributes(_stub_card("Fernando Alonso", wins=32, podiums=106, starts=401, championships=2, overall=88.0, hero_team="Aston Martin"))
        lec = compute_fair_attributes(_stub_card("Charles Leclerc", wins=8, podiums=43, starts=147, championships=0, overall=84.0, hero_team="Ferrari"))
        alb = compute_fair_attributes(_stub_card("Alexander Albon", wins=0, podiums=2, starts=104, championships=0, overall=74.0, hero_team="Williams"))
        strl = compute_fair_attributes(_stub_card("Lance Stroll", wins=0, podiums=3, starts=166, championships=0, overall=71.0, hero_team="Aston Martin"))

        for prof in (ver, ham, sen, alo, lec, alb, strl):
            self.assertIn("discipline", prof["stats"])
            self.assertGreaterEqual(prof["fair_overall"], 50.0)
            self.assertLessEqual(prof["fair_overall"], 99.0)
            self.assertGreaterEqual(prof["car_strength_est"], 50.0)
            self.assertLessEqual(prof["car_strength_est"], 99.0)

        # Legends sit firmly in ICON tier (91-99) and clearly beat midfielders
        self.assertGreaterEqual(ver["fair_overall"], 92.0)
        self.assertGreaterEqual(ham["fair_overall"], 92.0)
        self.assertGreaterEqual(sen["fair_overall"], 91.0)
        self.assertGreater(alo["fair_overall"], lec["fair_overall"])
        self.assertGreater(lec["fair_overall"], alb["fair_overall"])
        self.assertGreater(alb["fair_overall"], strl["fair_overall"])
        # Wet legends shine in WET stat
        self.assertGreaterEqual(sen["stats"]["wet"], 90)
        self.assertGreaterEqual(ver["stats"]["wet"], 88)

    def test_game_profile_and_api_endpoints(self):
        card = _stub_card("Max Verstappen", wins=63, podiums=112, starts=209, championships=4, overall=95.0, hero_team="Red Bull")
        gp = compute_game_profile(card, year=2024)
        self.assertIn("fair_overall", gp)
        self.assertIn("car_strength_est", gp)
        self.assertIn("telemetry", gp)
        self.assertIn("wet", gp["stats"])
        self.assertIn("tyre_care", gp["stats"])
        self.assertIn("discipline", gp["stats"])

        # Direct router call tests
        api_res = api_fair_driver_rating(name="Ayrton Senna", year=None)
        self.assertEqual(api_res["driver"], "Ayrton Senna")
        self.assertGreaterEqual(api_res["fair_overall"], 90.0)
        self.assertGreater(api_res["telemetry"]["mech_dnf_pct"], 18.0)

        deck = api_game_deck(source="season", year=2025, decade=2020, limit=25)
        self.assertTrue(len(deck["cards"]) >= 18)
        sample = deck["cards"][0]
        self.assertIn("raw_overall", sample)
        self.assertIn("wet", sample["game"]["stats"])
        self.assertIn("tyre_care", sample["game"]["stats"])
        self.assertIn("telemetry", sample["game"])


if __name__ == "__main__":
    unittest.main()
