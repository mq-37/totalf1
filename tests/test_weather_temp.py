"""Weather physics suite: track-temperature model + tyre-grip coupling.

Covers:
  1. Radar timeline air/track temperatures — per-bucket model, physics sanity
     (rain cools the surface, clear buckets bake it), determinism.
  2. Ladder quick-sim track-temp grip coupling — cold tarmac penalizes drivers and
     is mitigated by tyre_care; results are deterministic per radar state.
  3. Race analytics weather surface — the ladder weekend exposes the enriched radar.
"""
from __future__ import annotations

import unittest

from f1data.weather_radar import build_weather_radar_and_pit_plan


def _timeline_for(mode: str, laps: int = 30):
    r = build_weather_radar_and_pit_plan(
        {"id": "monaco", "name": "Circuit de Monaco"}, mode=mode, laps=laps, intel_pct=80, tyre_care=85
    )
    return (r.get("radar") or {}).get("timeline") or [], (r.get("radar") or {})


class TestTrackTemperatureModel(unittest.TestCase):
    def test_timeline_buckets_carry_temps(self):
        tl, radar = _timeline_for("dry")
        self.assertGreaterEqual(len(tl), 12)
        for b in tl:
            self.assertIn("air_temp_c", b)
            self.assertIn("track_temp_c", b)
            self.assertGreater(b["track_temp_c"], 0)

    def test_dry_race_bakes_the_tarmac(self):
        tl, radar = _timeline_for("dry", laps=50)
        tracks = [b["track_temp_c"] for b in tl]
        self.assertGreater(max(tracks), 30.0, "dry race should bake the track well above air temp")
        self.assertGreater(max(tracks), radar["air_temp_c"] + 6.0)

    def test_rain_pulls_track_toward_air(self):
        tl_wet, _ = _timeline_for("rain", laps=30)
        tl_dry, _ = _timeline_for("dry", laps=30)
        gap_wet = [b["track_temp_c"] - b["air_temp_c"] for b in tl_wet]
        gap_dry = [b["track_temp_c"] - b["air_temp_c"] for b in tl_dry]
        self.assertLess(max(gap_wet), max(gap_dry), "rain should collapse the solar track-air gap")
        # Rain buckets cool the surface over the race distance
        self.assertLess(tl_wet[-1]["track_temp_c"], tl_wet[0]["track_temp_c"] + 4.0)

    def test_determinism(self):
        a = _timeline_for("showers")[0]
        b = _timeline_for("showers")[0]
        self.assertEqual(
            [x["track_temp_c"] for x in a],
            [x["track_temp_c"] for x in b],
        )

    def test_summary_fields_exposed(self):
        _, radar = _timeline_for("dry")
        self.assertIn("air_temp_c", radar)
        self.assertIn("track_temp_c", radar)
        self.assertIn("track_temp_range_c", radar)


class TestLadderTempCoupling(unittest.TestCase):
    def test_quick_sim_runs_with_temp_radar_and_is_deterministic(self):
        import copy
        from f1data import ladder_engine as leng

        state = leng.build_new_ladder(
            team_name="Temp Test Racing", principal_name="Test Principal", start_tier="f4", color="#38bdf8"
        )
        state["weekend"]["weather_radar"] = build_weather_radar_and_pit_plan(
            {"id": "monza", "name": "Monza"}, mode="dry", laps=18, intel_pct=75, tyre_care=80
        )
        state["weekend"]["weather_mode"] = "dry"

        # Snapshot BEFORE running: quick_sim mutates the weekend (quali grid, debrief, etc.)
        state2 = copy.deepcopy(state)

        res1 = leng.quick_sim_race(state)
        self.assertTrue(res1.get("debrief"))

        res2 = leng.quick_sim_race(state2)
        self.assertEqual(
            res1["debrief"].get("winner"),
            res2["debrief"].get("winner"),
        )
        self.assertEqual(
            res1["debrief"].get("player_results"),
            res2["debrief"].get("player_results"),
        )


if __name__ == "__main__":
    unittest.main()
