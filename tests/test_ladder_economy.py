"""PR 4 tests: Spare-parts inventory, F1 Cost Cap accounting, Inbox Dilemmas & Paddock Politics."""
from __future__ import annotations

import random
import unittest
from pathlib import Path

from f1data import ladder_economy as leco
from f1data import ladder_engine as leng


class TestLadderEconomyAndPolitics(unittest.TestCase):
    def test_spare_parts_crash_deduction_and_emergency_cost_cap(self):
        # Karting is exempt from spare-parts tracking
        kart = leng.build_new_ladder(start_tier="karting", seed=101)
        self.assertEqual(leco.get_spare_parts_view(kart), [])
        ok_k, _ = leng.manufacture_spare_part(kart, "wing_kit")
        self.assertFalse(ok_k)

        # Tier 5 F1 tracks 4 distinct aero/chassis components
        st = leng.build_new_ladder(start_tier="f1", seed=404)
        parts = leco.ensure_spare_parts(st)
        self.assertEqual(set(parts.keys()), {"front_wing", "suspension", "floor", "chassis_tub"})
        initial_fw = parts["front_wing"]

        # Manufacture 1 front_wing -> increments stock & counts against F1 Cost Cap!
        cap_before = st["economy"]["cost_cap_spent_k"]
        cash_before = st["economy"]["cash_k"]
        ok_m, msg_m = leng.manufacture_spare_part(st, "front_wing")
        self.assertTrue(ok_m, msg_m)
        self.assertEqual(st["economy"]["spare_parts"]["front_wing"], initial_fw + 1)
        self.assertGreater(st["economy"]["cost_cap_spent_k"], cap_before)
        self.assertLess(st["economy"]["cash_k"], cash_before)

        # Crash when stock > 0 deducts from stock first (no emergency manufacture)
        res_in_stock = leco.consume_crash_parts(st, random.Random(7), heavy=False)
        self.assertEqual(len(res_in_stock["consumed"]), 1)
        self.assertEqual(res_in_stock["emergency_parts"], [])

        # Deplete ALL stock to 0 -> crash triggers emergency manufacture (1.45x) counting toward Cost Cap!
        for k in list(st["economy"]["spare_parts"].keys()):
            st["economy"]["spare_parts"][k] = 0
        leng.run_qualifying(st)
        p_id = st["player"]["driver_ids"][0]
        standings = [
            {
                "driver_id": g["driver_id"],
                "name": g["name"],
                "pos": i + 1,
                "dnf": g["driver_id"] == p_id,
                "crash_damage": g["driver_id"] == p_id,
            }
            for i, g in enumerate(st["weekend"]["quali_grid"])
        ]
        cap_pre_race = st["economy"]["cost_cap_spent_k"]
        exempt_pre_race = st["economy"]["exempt_spent_k"]
        commit = leng.commit_race_results(st, standings)
        p_res = next(r for r in commit["debrief"]["player_results"] if r["driver_id"] == p_id)
        self.assertTrue(len(p_res["emergency_parts"]) >= 1)
        self.assertGreater(p_res["crash_bill_k"], 500.0)
        # Cost Cap MUST include emergency crash repairs + race ops; exempt MUST include driver & top-3 staff salaries
        self.assertGreater(st["economy"]["cost_cap_spent_k"], cap_pre_race + p_res["crash_bill_k"])
        self.assertGreater(st["economy"]["exempt_spent_k"], exempt_pre_race)
        # Facility CapEx upgrade must remain Cost-Cap EXEMPT!
        cap_before_capex = st["economy"]["cost_cap_spent_k"]
        exempt_before_capex = st["economy"]["exempt_spent_k"]
        ok_fac, _ = leng.upgrade_facility(st, "pit_rig")
        self.assertTrue(ok_fac)
        self.assertEqual(st["economy"]["cost_cap_spent_k"], cap_before_capex)
        self.assertGreater(st["economy"]["exempt_spent_k"], exempt_before_capex)

    def test_academy_kpi_dilemma_generation_and_resolution(self):
        st = leng.build_new_ladder(start_tier="f3", seed=202)
        ok_ad, _ = leng.sign_academy_deal(st, st["academy_offers"][0]["id"])
        self.assertTrue(ok_ad)

        dil = leco.generate_round_dilemma(st, random.Random(9), force_kind="academy_kpi")
        self.assertIsNotNone(dil)
        self.assertEqual(dil["kind"], "academy_kpi")
        self.assertFalse(dil["resolved"])

        cash_before = st["economy"]["cash_k"]
        seat2_id = st["player"]["driver_ids"][1]
        trust_before = st["drivers"][seat2_id]["trust"]

        ok_res, msg = leng.resolve_dilemma(st, dil["id"], "prioritize_junior")
        self.assertTrue(ok_res, msg)
        self.assertTrue(dil["resolved"])
        self.assertGreater(st["economy"]["cash_k"], cash_before)
        self.assertGreaterEqual(st["drivers"][seat2_id]["trust"], trust_before)

        # Double-resolve should be rejected cleanly
        ok_dup, _ = leng.resolve_dilemma(st, dil["id"], "equal_treatment")
        self.assertFalse(ok_dup)

    def test_f1_paddock_profiles_voting_and_fia_docs_precedent(self):
        st = leng.build_new_ladder(start_tier="f1", seed=505)
        self.assertIn("tp_roster", st["fia_governance"])
        self.assertGreaterEqual(len(st["fia_governance"]["tp_roster"]), 10)

        # Authentic precedent lookup from data/fia_docs.sqlite
        prec = leco.fetch_fia_technical_precedent("Aero", seed=42)
        db_exists = (Path(__file__).resolve().parent.parent / "data" / "fia_docs.sqlite").exists()
        if db_exists:
            self.assertEqual(prec["source"], "fia_docs.sqlite")
        self.assertTrue(prec["title"])
        self.assertTrue(prec["rules_referenced"])

        # F1 Technical Directive dilemma embeds fia_docs.sqlite precedent
        td_dil = leco.generate_round_dilemma(st, random.Random(11), force_kind="fia_td")
        self.assertIsNotNone(td_dil)
        self.assertEqual(td_dil["kind"], "fia_td")
        self.assertIn("precedent", td_dil)

        # Vote via real paddock_profiles + regulation_architect bridge
        ok_v, msg_v = leng.vote_fia_proposal(st, "yes")
        self.assertTrue(ok_v, msg_v)
        tally = st["fia_governance"]["last_tally"]
        self.assertIn("votes", tally)
        self.assertGreaterEqual(len(tally["votes"]), 9)
        self.assertIn("leadership_style", tally["votes"][0])
        self.assertIn("job_stress", tally["votes"][0])
        self.assertIn("formula_metrics", tally)
        self.assertIn("fia_precedent", tally)
        self.assertEqual(tally["player_vote"], "YES")

        # Serialized view includes spare_parts & fia_precedent
        view = leng.serialize_ladder_view(st)
        self.assertEqual(len(view["spare_parts"]), 4)
        self.assertIsNotNone(view["fia_precedent"])


if __name__ == "__main__":
    unittest.main()
