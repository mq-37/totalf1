"""Automated tests for TRAF1 Master Upgrade: Career Analytics, 12-Pt Super Licence, Stewards, PU Contracts, F1 Commission, Paddock Dialogue & What-If GP."""
from __future__ import annotations

import copy
import socket
import threading
import time
import unittest

import requests
import uvicorn

from f1data import career as c_mod, career_extras as cx, f1db, paddock_dialogue as pdlg
from f1data import server as srv


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestCareerMasterUpgrade(unittest.TestCase):
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
                if requests.get(f"{cls.base_url}/api/dialogue/voice-pack", timeout=0.5).status_code == 200:
                    break
            except Exception:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._server.should_exit = True
        cls._thread.join(timeout=3)

    def test_paddock_dialogue_voice_pack_and_driver_signatures(self) -> None:
        r = requests.get(f"{self.base_url}/api/dialogue/voice-pack", timeout=5)
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertGreaterEqual(len(data["drivers"]), 18)
        self.assertIn("tyre_bluff", data["tropes"])
        self.assertIn("proactive_undercut", data["tropes"])

        ver_win = pdlg.get_driver_voice_line("Max Verstappen VER", "win", banter_mode="authentic")
        self.assertIsNotNone(ver_win)
        self.assertIn("lovely", ver_win.lower())
        self.assertIsNone(pdlg.get_driver_voice_line("Max Verstappen", "win", banter_mode="strict"))
        self.assertGreaterEqual(len(pdlg.TROPE_DILEMMAS), 6)

    def test_existing_career_save_backwards_compat_and_analytics(self) -> None:
        raw = c_mod.load_career(srv._career_base_dir())
        self.assertIsNotNone(raw, "Expected existing career save for backwards-compat check")
        st = copy.deepcopy(raw)
        c_mod._ensure_career_v2(st)
        payload = c_mod.serialize_career_payload(st, srv._career_base_dir())
        self.assertTrue(payload["has_career"])
        self.assertIn("pu_suppliers", payload)
        self.assertIn("max_player_penalty_pts", payload)

        an = cx.compute_career_analytics(st, srv.DATA_DB)
        self.assertGreaterEqual(len(an["teammateH2H"]), 2)
        self.assertEqual(len(an["nextGp"]["strategies"]), 3)
        self.assertTrue(any(s["recommended"] for s in an["nextGp"]["strategies"]))
        self.assertGreater(len(an["superLicenceGrid"]), 10)

        # Live HTTP endpoint check
        r_an = requests.get(f"{self.base_url}/api/career/analytics", timeout=5)
        self.assertEqual(r_an.status_code, 200)
        self.assertTrue(r_an.json()["ok"])

    def test_stewards_12_point_ban_pu_contract_and_commission_vote_isolated(self) -> None:
        raw = c_mod.load_career(srv._career_base_dir())
        st = copy.deepcopy(raw)
        c_mod._ensure_career_v2(st)
        pt = c_mod.get_player_team(st)
        d0_id = pt["driver_ids"][0]
        d0 = st["drivers"][d0_id]

        # Push driver to 10 penalty points then trigger a 2-pt Stewards ruling -> 12-pt automatic 1-race ban!
        d0["penalty_log"] = [{"abs_round": 1, "pts": 10, "gp": "Monza", "reason": "test"}]
        d0["penalty_points"] = 10
        st["pending_stewards"] = {
            "id": "doc-test-42",
            "doc_number": 42,
            "season": st["season_num"],
            "round": st["current_round"],
            "abs_round": 2,
            "gp": "Las Vegas GP",
            "code": "collision",
            "driver_id": d0_id,
            "driver_name": d0["clean_name"],
            "car_number": 1,
            "team_name": pt["name"],
            "fact": "Contact at Turn 14",
            "offence": "Appendix L Ch IV Art 2(d)",
            "decision": "10s + 2 penalty points",
            "reason": "Front axle not alongside mirror.",
            "rules_referenced": ["Appendix L"],
            "penalty_points": 2,
            "fine_eur": 0,
            "grid_drop": 0,
            "status": "pending",
        }
        ok, msg = cx.respond_stewards_hearing(st, "accept", c_mod._log_finance, c_mod._add_inbox)
        self.assertTrue(ok)
        self.assertIn("1-RACE BAN", msg)
        self.assertEqual(d0["race_ban_rounds"], 1)
        self.assertIsNone(st["pending_stewards"])

        # Power Unit Supplier contract switch
        st["cash_m"] = 50.0
        ok_pu, msg_pu = cx.sign_pu_contract(st, "ferrari_pu", c_mod.get_player_team, c_mod._log_finance, c_mod._add_inbox)
        self.assertTrue(ok_pu, msg_pu)
        self.assertEqual(st["pu_contract"]["supplier_id"], "ferrari_pu")

        # F1 Commission vote
        st["f1_commission"]["voted_ids"] = {}
        prop_id = st["f1_commission"]["proposals"][0]["id"]
        ok_v, msg_v = cx.cast_commission_vote(st, prop_id, True, c_mod._add_inbox)
        self.assertTrue(ok_v, msg_v)
        self.assertIn(prop_id, st["f1_commission"]["voted_ids"])

    def test_historical_what_if_gp_endpoint(self) -> None:
        for yr, rnd, exp_cid in ((2026, 21, "vegas"), (2021, 22, "abudhabi"), (1988, 3, "monaco")):
            r = requests.get(f"{self.base_url}/api/f1db/what-if/{yr}/{rnd}", timeout=5)
            self.assertEqual(r.status_code, 200)
            d = r.json()
            self.assertTrue(d["ok"])
            self.assertEqual(d["circuitId"], exp_cid)
            self.assertGreaterEqual(len(d["grid"]), 18)


if __name__ == "__main__":
    unittest.main()
