"""Comprehensive unit & integration tests for Pit Wall: The Ladder (5-tier career mode)."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import f1data.server  # noqa: F401
from f1data import ladder_db as ldb
from f1data import ladder_engine as leng


class TestPitWallTheLadder(unittest.TestCase):
    def test_tier_unlock_matrix_strictly_gates_mechanics(self):
        # Karting: zero radio, zero pit stops, kart tuning active
        k_u = leng.TIER_CONFIG["karting"]["unlocks"]
        self.assertTrue(k_u["kart_tuning"])
        self.assertFalse(k_u["live_radio"])
        self.assertFalse(k_u["pit_stops"])
        self.assertFalse(k_u["crash_damage_economy"])

        # F4: unlocks radio, wet pit stops, practice, crash damage; still no DRS or Academy
        f4_u = leng.TIER_CONFIG["f4"]["unlocks"]
        self.assertTrue(f4_u["live_radio"])
        self.assertTrue(f4_u["pit_stops"])
        self.assertTrue(f4_u["crash_damage_economy"])
        self.assertFalse(f4_u["drs"])
        self.assertFalse(f4_u["academy_affiliates"])

        # F3: unlocks 30-car grids, DRS, Reverse-Grid Sprint, F1 Academy Affiliates
        f3_u = leng.TIER_CONFIG["f3"]["unlocks"]
        self.assertEqual(leng.TIER_CONFIG["f3"]["grid_size"], 30)
        self.assertTrue(f3_u["drs"])
        self.assertTrue(f3_u["reverse_grid_sprint"])
        self.assertTrue(f3_u["academy_affiliates"])
        self.assertFalse(f3_u["mandatory_pit"])

        # F2: unlocks mandatory pit stops, Prime/Option, Pit Crew, Driver Ego & Trust
        f2_u = leng.TIER_CONFIG["f2"]["unlocks"]
        self.assertTrue(f2_u["mandatory_pit"])
        self.assertTrue(f2_u["prime_option_tyres"])
        self.assertTrue(f2_u["driver_ego_trust"])
        self.assertFalse(f2_u["cost_cap"])

        # F1: unlocks Custom R&D correlation, Cost Cap, ERS, Team Orders, FIA Voting, Gardening Leave
        f1_u = leng.TIER_CONFIG["f1"]["unlocks"]
        for k in ("ers_engine_modes", "team_orders", "custom_rd_correlation", "cost_cap", "fia_voting", "gardening_leave"):
            self.assertTrue(f1_u[k], f"F1 must unlock {k}")

    def test_concurrent_5_tier_race_and_fog_of_war_scouting(self):
        st = leng.build_new_ladder(team_name="Veloce Kart", start_tier="karting", seed=42)
        self.assertEqual(len(st["tiers"]), 5)

        # Fog-of-war market driver starts unscouted
        mkt = next(d for d in st["drivers"].values() if d["team"] == "Free Agent" and not d["scouted"])
        self.assertFalse(mkt["trait_revealed"])
        ok, msg = leng.scout_driver(st, mkt["id"])
        self.assertTrue(ok, msg)
        self.assertTrue(mkt["scouted"])
        self.assertTrue(mkt["trait_revealed"])
        self.assertEqual(mkt["pot_lo"], mkt["potential"])

        # Karting setup -> Qualifying -> Quick Sim advances ALL 5 tiers concurrently!
        res_s = leng.apply_setup_and_practice(st, {"chassis_flex": 55, "gear_ratio": 50, "tyre_pressure": 52, "coaching": "slipstream"})
        self.assertTrue(res_s["ok"])
        res_q = leng.run_qualifying(st, tactic="late_evolution")
        self.assertTrue(res_q["ok"])
        self.assertGreaterEqual(len(res_q["grid"]), 16)

        res_r = leng.quick_sim_race(st)
        self.assertTrue(res_r["ok"])
        self.assertEqual(st["round"], 2)
        for tid in ("f4", "f3", "f2", "f1"):
            self.assertEqual(st["tiers"][tid]["round"], 2, f"Background tier {tid} should advance concurrently")

    def test_f3_academy_and_f2_to_f1_hybrid_career_fork_and_super_license(self):
        # Test F3 Reverse-Grid Sprint & Academy Affiliate Deal
        st3 = leng.build_new_ladder(team_name="Horizon Junior", start_tier="f3", seed=99)
        ok_a, msg_a = leng.sign_academy_deal(st3, "acad_ferrari")
        self.assertTrue(ok_a, msg_a)
        self.assertIsNotNone(st3["academy_deal"])
        q3 = leng.run_qualifying(st3, tactic="clean_air")
        self.assertIsNotNone(q3["sprint_result"], "F3 qualifying should run Reverse-Grid Sprint")

        # Test F2 -> F1 Path A (The Poach) leaves original feeder team as AI rival
        st2 = leng.build_new_ladder(team_name="Nordic GP", start_tier="f2", seed=123)
        ok_p, msg_p = leng.choose_career_fork_or_promote(st2, "poach", target_f1_team="Williams")
        self.assertTrue(ok_p, msg_p)
        self.assertEqual(st2["tier"], "f1")
        self.assertEqual(st2["player"]["team_name"], "Williams")
        self.assertEqual(st2["player"]["career_path"], "poached_tp")
        self.assertFalse(st2["player"]["owns_team"])
        self.assertEqual(st2["player"]["original_feeder_team"], "Nordic GP")

        # Test F2 -> F1 Path B (The Constructor Bid) keeps owner control
        st2b = leng.build_new_ladder(team_name="Emerald Racing", start_tier="f2", seed=456)
        ok_b, msg_b = leng.choose_career_fork_or_promote(st2b, "constructor_bid")
        self.assertTrue(ok_b, msg_b)
        self.assertEqual(st2b["tier"], "f1")
        self.assertEqual(st2b["player"]["team_name"], "Emerald Racing")
        self.assertEqual(st2b["player"]["career_path"], "constructor_bid")
        self.assertTrue(st2b["player"]["owns_team"])

    def test_f1_endgame_rd_correlation_cost_cap_gardening_leave_and_fia_vote(self):
        st1 = leng.build_new_ladder(team_name="Apex F1", start_tier="f1", seed=777)
        # Super License enforcement in F1 blocks <40-pt junior
        junior = next(d for d in st1["drivers"].values() if d["sl_points"] < 40)
        ok_blk, msg_blk = leng.sign_driver(st1, junior["id"], replace_idx=1)
        self.assertFalse(ok_blk)
        self.assertIn("Super License", msg_blk)

        # Develop F1 package -> counts against Cost Cap -> Practice validates correlation!
        cap_before = st1["economy"]["cost_cap_spent_k"]
        ok_rd, msg_rd = leng.develop_f1_upgrade(st1, "low_speed_df", "Monza Spec Floor")
        self.assertTrue(ok_rd, msg_rd)
        self.assertGreater(st1["economy"]["cost_cap_spent_k"], cap_before)
        res_p = leng.apply_setup_and_practice(st1, {"front_wing": 60, "rear_wing": 60, "ride_height": 50})
        self.assertTrue(len(res_p["correlation_notes"]) == 1)
        self.assertEqual(len(st1["rd"]["upgrade_log"]), 1)

        # Staff poaching enforces mandatory Gardening Leave rounds in F1
        ok_st, msg_st = leng.poach_staff(st1, "mkt_st_1")
        self.assertTrue(ok_st, msg_st)
        poached = next(s for s in st1["staff"] if s["id"] == "mkt_st_1")
        self.assertEqual(poached["gardening_rounds_left"], 3)

        # FIA Regulation Vote works
        ok_v, msg_v = leng.vote_fia_proposal(st1, "yes")
        self.assertTrue(ok_v, msg_v)
        self.assertTrue(st1["fia_governance"]["voted"])

    def test_sqlite_relational_persistence_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            st = leng.build_new_ladder(team_name="SaveTest Racing", start_tier="f4", seed=11)
            sid = ldb.save_state(base, st)
            saves = ldb.list_saves(base)
            self.assertEqual(len(saves), 1)
            self.assertEqual(saves[0]["save_id"], sid)
            loaded = ldb.load_save(base, sid)
            self.assertEqual(loaded["player"]["team_name"], "SaveTest Racing")
            self.assertTrue(ldb.delete_save(base, sid))
            self.assertEqual(len(ldb.list_saves(base)), 0)


if __name__ == "__main__":
    unittest.main()
