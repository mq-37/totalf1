"""Lore & AI-voice content depth suite.

Covers the driver-response depth engine:
  1. Persona segment composer — variation floor, determinism, confidence bands, mood axis.
  2. Driver-DNA flavour tags — trait/context matching, cap, curated + synthesised fallbacks.
  3. Persona radio pack — tone shaping (hot/steady/low), situation coverage per persona.
  4. Ladder debrief quotes — composition, determinism, TP reaction, API endpoint wiring.
  5. /sim interview enrichment — confBand / mood / partingQuote fields on the API payload.
"""
from __future__ import annotations

import unittest

from f1data.driver_dna import flavour_tags
from f1data.interviews import _conf_band, _persona_voice
from f1data.ladder_lore import build_debrief_quotes, _mood_for
from f1data.paddock_dialogue import get_radio_line, PERSONA_RADIO_PACK

PERSONAS = ("iceman", "fiery_racer", "perfectionist", "rookie_hungry", "veteran_statesman", "team_player")
MOODS = ("elated", "confident", "mixed", "frustrated", "shaken")

_CTX = {
    "circuit": "Monte Carlo", "finish_pos": 3, "grid_pos": 8, "gain": 5, "overtakes": 4,
    "mistakes": 0, "pit_delay": 0.2, "end_conf": 88, "had_wet": True, "had_sc": True,
    "dnf": False, "aff": 0.8, "eng_name": "Gio", "era_label": "2026 Rules", "is_street": True,
    "peak_conf": 91, "end_mom": 12,
}


class TestPersonaComposer(unittest.TestCase):
    def test_variation_floor_same_persona_mood_across_seeds(self):
        """The user-visible guarantee: same driver, same mood, different races => different words."""
        for persona in PERSONAS:
            outs = {_persona_voice(persona, "confident", _CTX, f"race-{i}") for i in range(10)}
            self.assertGreaterEqual(len(outs), 8, f"{persona} produced only {len(outs)} distinct answers over 10 seeds")

    def test_variation_across_moods_and_personas(self):
        for persona in PERSONAS:
            for mood in MOODS:
                line = _persona_voice(persona, mood, _CTX, "deterministic")
                self.assertTrue(line.strip(), f"{persona}/{mood} produced an empty answer")
        # All 30 persona×mood answers should not collapse into a single voice
        outs = {_persona_voice(p, m, _CTX, "grid") for p in PERSONAS for m in MOODS}
        self.assertGreaterEqual(len(outs), 20)

    def test_determinism_same_seed_same_answer(self):
        a = _persona_voice("perfectionist", "mixed", _CTX, "seed-x")
        b = _persona_voice("perfectionist", "mixed", _CTX, "seed-x")
        self.assertEqual(a, b)

    def test_confidence_bands_change_the_answer(self):
        lines = []
        for c in (90, 72, 55, 32):
            lines.append(_persona_voice("fiery_racer", "confident", {**_CTX, "end_conf": c}, "fixed"))
        self.assertEqual(len(set(lines)), 4, "confidence bands must produce distinct bodies")
        self.assertEqual(_conf_band(90), "soaring")
        self.assertEqual(_conf_band(72), "assured")
        self.assertEqual(_conf_band(55), "measured")
        self.assertEqual(_conf_band(20), "rattled")

    def test_mood_axis_shapes_the_opening(self):
        elated = _persona_voice("iceman", "elated", _CTX, "s")
        shaken = _persona_voice("iceman", "shaken", _CTX, "s")
        self.assertNotEqual(elated.split(".")[0], shaken.split(".")[0])

    def test_callbacks_fire_on_real_context(self):
        ctx_pit = {**_CTX, "pit_delay": 1.4}
        with_pit = _persona_voice("team_player", "frustrated", ctx_pit, "pit-test")
        self.assertIn("stop", with_pit)
        ctx_sc = {**_CTX, "had_sc": True, "pit_delay": 0.0}
        with_sc = _persona_voice("rookie_hungry", "mixed", ctx_sc, "sc-test")
        self.assertIn("safety car", with_sc.lower())

    def test_all_placeholders_resolve(self):
        """No stray {placeholders} may survive into a player-facing answer."""
        for persona in PERSONAS:
            for mood in MOODS:
                for seed in ("a", "b", "c"):
                    out = _persona_voice(persona, mood, _CTX, seed)
                    self.assertNotIn("{", out, f"{persona}/{mood}/{seed} leaked a placeholder: {out}")


class TestFlavourTags(unittest.TestCase):
    def test_curated_legend_gets_context_tags(self):
        tags = flavour_tags("Ayrton Senna")
        self.assertTrue(tags)
        self.assertIn("wet", tags)

    def test_unknown_driver_still_gets_flavour(self):
        self.assertTrue(flavour_tags("Zed Quasar"))

    def test_tag_cap(self):
        # Legends are strong everywhere; the cap keeps answers from over-flavouring.
        self.assertLessEqual(len(flavour_tags("Ayrton Senna", max_tags=2)), 2)


class TestRadioPack(unittest.TestCase):
    def test_every_persona_has_every_situation_in_every_tone(self):
        situations = ("attack", "defend", "box_call", "tyre", "gap", "retire", "praise")
        for persona in PERSONAS:
            for sit in situations:
                for tone in ("hot", "steady", "low"):
                    line = get_radio_line(persona, sit, mood="elated" if tone == "hot" else ("shaken" if tone == "low" else "steady"),
                                          conf=90 if tone == "hot" else (25 if tone == "low" else 60), seed=f"{persona}{sit}{tone}")
                    self.assertTrue(line, f"{persona}/{sit}/{tone} has no radio line")

    def test_tone_shifts_with_confidence(self):
        hot = get_radio_line("fiery_racer", "tyre", mood="elated", conf=90, seed="t")
        low = get_radio_line("fiery_racer", "tyre", mood="shaken", conf=25, seed="t")
        self.assertNotEqual(hot, low)

    def test_unknown_persona_falls_back_to_team_player(self):
        self.assertTrue(get_radio_line("mystery_man", "attack", seed="s"))


_DEBRIEF = {
    "circuit_name": "Zandvoort", "winner": "A. Verstappen", "weather": "Light Rain",
    "safety_cars": 1, "rep_delta": 1.4, "crash_bill_k": 30.0,
    "player_results": [
        {"name": "L. Vance", "team": "Kart Elite", "finish_pos": 2, "grid_pos": 5, "end_conf": 84, "persona": "fiery_racer"},
        {"name": "R. Stone", "team": "Kart Elite", "finish_pos": 11, "grid_pos": 8, "end_conf": 38, "persona": "rookie_hungry"},
    ],
}


class TestLadderDebriefQuotes(unittest.TestCase):
    def test_shape_and_depth(self):
        out = build_debrief_quotes(_DEBRIEF, tier="kart", player_tp="Maro Engel", player_team="Kart Elite", season=1, round_num=3)
        self.assertTrue(out["ok"])
        self.assertEqual(len(out["quotes"]), 2)
        for q in out["quotes"]:
            self.assertTrue(q["quote"].strip())
            self.assertIn(q["mood"], MOODS)
            self.assertIn(q["conf_band"], ("soaring", "assured", "measured", "rattled"))
        self.assertTrue(out["tp_reaction"]["quote"].strip())
        self.assertTrue(out["tp_reaction"]["name"])

    def test_determinism(self):
        a = build_debrief_quotes(_DEBRIEF, season=2, round_num=4)
        b = build_debrief_quotes(_DEBRIEF, season=2, round_num=4)
        self.assertEqual([q["quote"] for q in a["quotes"]], [q["quote"] for q in b["quotes"]])
        self.assertEqual(a["tp_reaction"]["quote"], b["tp_reaction"]["quote"])

    def test_mood_inference(self):
        self.assertEqual(_mood_for(1, 1, 90, False), "elated")
        self.assertEqual(_mood_for(20, 4, 30, False), "shaken")
        self.assertEqual(_mood_for(6, 6, 30, True), "shaken")
        self.assertIn(_mood_for(8, 8, 55, False), ("mixed", "frustrated"))


class TestSimInterviewEnrichment(unittest.TestCase):
    """The /sim interview API payload must carry the depth metadata the UI now renders."""

    TELEMETRY = {
        "raceFinished": True, "circuitName": "Monte Carlo", "eraLabel": "2026 Rules",
        "drivers": [
            {"idx": 0, "name": "L. Vance", "code3": "LVA", "team": "McLaren", "color": "#ff8000",
             "gridPos": 5, "persona": "fiery_racer", "isPlayer": True, "engineerName": "Gio", "trackAffinity": 0.2},
        ],
        "stints": [
            {"idx": 0, "finishPos": 2, "dnf": False, "endConf": 86, "peakConf": 90, "minConf": 55,
             "endMom": 14, "overtakes": 3, "mistakes": 0, "pitDelayS": 0.2},
        ],
        "events": [], "frames": [], "radioLog": [],
    }

    def test_generate_race_interviews_fields(self):
        from f1data.interviews import generate_race_interviews
        out = generate_race_interviews(self.TELEMETRY)
        self.assertTrue(out)
        rep = out[0]
        self.assertIn("confBand", rep)
        self.assertIn("mood", rep)
        self.assertIn("partingQuote", rep)
        self.assertTrue(rep["partingQuote"].strip())
        self.assertEqual(rep["confBand"], "soaring")
        self.assertEqual(rep["mood"], "elated")


if __name__ == "__main__":
    unittest.main()
