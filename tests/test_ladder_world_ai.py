"""Deterministic unit tests for PR 2: Living 5-Tier World AI (f1data/ladder_world_ai.py)."""
from __future__ import annotations

import random
import tempfile
import unittest
from pathlib import Path

import f1data.server  # noqa: F401
from f1data import ladder_db as ldb
from f1data import ladder_engine as leng
from f1data import ladder_world_ai as lwai


class TestLadderWorldAI(unittest.TestCase):
    def test_super_license_40pt_auto_graduation_into_open_f1_seat(self):
        st = leng.build_new_ladder(team_name="Origin F2", start_tier="f2", seed=101)
        rng = random.Random(101)

        # Age one AI F1 driver to retirement threshold (>=38)
        f1_ai_team = next(t for t in st["tiers"]["f1"]["teams"] if not t.get("is_player"))
        retiring_id = f1_ai_team["driver_ids"][0]
        st["drivers"][retiring_id]["age"] = 40

        # Ensure an AI F2 driver has >= 40 Super License points
        f2_ai_team = next(t for t in st["tiers"]["f2"]["teams"] if not t.get("is_player"))
        star_id = f2_ai_team["driver_ids"][0]
        st["drivers"][star_id]["sl_history"] = [20, 20, 0]
        st["drivers"][star_id]["sl_points"] = 40
        st["drivers"][star_id]["sl_eligible"] = True
        st["drivers"][star_id]["season_pts"] = 250.0

        summary = lwai.run_inter_tier_driver_flow(st, rng, leng._make_driver)
        self.assertGreaterEqual(len(summary["f1_graduations"]), 1)
        self.assertEqual(st["drivers"][retiring_id]["tier"], "retired")
        self.assertEqual(st["drivers"][star_id]["tier"], "f1")
        self.assertIn(star_id, f1_ai_team["driver_ids"])

    def test_karting_regen_spawning_and_inter_tier_promotions(self):
        st = leng.build_new_ladder(team_name="Apex Kart", start_tier="karting", seed=202)
        rng = random.Random(202)
        summary = lwai.run_inter_tier_driver_flow(st, rng, leng._make_driver)

        # Promotions happen across feeder tiers & fresh 13-15yo Karting regens spawn with Fog-of-War mask
        self.assertGreater(len(summary["promotions"]), 0)
        self.assertGreaterEqual(len(summary["regens_spawned"]), 2)
        for rid in summary["regens_spawned"]:
            reg = st["drivers"][rid]
            self.assertEqual(reg["tier"], "karting")
            self.assertGreaterEqual(reg["age"], 13)
            self.assertLessEqual(reg["age"], 15)
            self.assertFalse(reg["scouted"])
            self.assertFalse(reg["trait_revealed"])
            self.assertEqual(reg["potential_ceiling"], reg["potential"])

    def test_ai_principal_firing_creates_player_f1_poach_offer_and_origin_team_survives(self):
        st = leng.build_new_ladder(team_name="Nordic Feeder GP", start_tier="f2", seed=303)
        st["player"]["reputation"] = 85.0
        rng = random.Random(303)

        # Force top-car F1 AI team to finish last in points -> triggers board firing
        f1_top = max(st["tiers"]["f1"]["teams"], key=lambda t: float(t["car_rating"]))
        for tm in st["tiers"]["f1"]["teams"]:
            tm["points"] = 100.0
        f1_top["points"] = 0.0

        res = lwai.evaluate_ai_principals_and_poaching(st, rng)
        self.assertTrue(any(f["team"] == f1_top["name"] for f in res["firings"]))
        self.assertTrue(any(o["f1_team"] == f1_top["name"] for o in st["player"]["poach_offers"]))
        self.assertTrue(st["player"]["fork_ready"])

        # Player accepts F1 Poach offer -> original feeder team survives in F2 as an AI rival!
        ok, msg = leng.choose_career_fork_or_promote(st, "poach", target_f1_team=f1_top["name"])
        self.assertTrue(ok, msg)
        self.assertEqual(st["tier"], "f1")
        self.assertEqual(st["player"]["team_name"], f1_top["name"])
        origin_in_f2 = next((t for t in st["tiers"]["f2"]["teams"] if t["name"] == "Nordic Feeder GP"), None)
        self.assertIsNotNone(origin_in_f2, "Origin feeder team must survive in F2 as an AI rival")
        self.assertFalse(origin_in_f2["is_player"])
        self.assertIn("(AI)", origin_in_f2["principal"])

    def test_atomic_wal_season_transition_commit(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            st = leng.build_new_ladder(team_name="Atomic GP", start_tier="karting", seed=404)
            sid = ldb.save_state(base, st)
            ok, _ = leng.choose_career_fork_or_promote(st, "promote")
            self.assertTrue(ok)
            ldb.commit_season_transition(base, sid, st, history_record=st["season_history"][0])

            loaded = ldb.load_save(base, sid)
            self.assertEqual(loaded["tier"], "f4")
            self.assertEqual(loaded["season"], 2)
            hist = ldb.get_season_history(base, sid)
            self.assertEqual(len(hist), 1)
            self.assertEqual(hist[0]["tier"], "karting")


if __name__ == "__main__":
    unittest.main()
