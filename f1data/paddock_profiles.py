"""
Data-Deduced Team Principal, Race Engineer & Driver Personality, Politics & Job-Stress Engine.

Combines curated real-world 2026 & historic F1 leadership dossiers with data deduced from
f1db.sqlite and fia_docs.sqlite:
  - 11 Real 2026 Team Principals (Wolff, Vasseur, Mekies, Stella, Wheatley, Vowles,
    Briatore, Komatsu, Binotto, Lowdon, Permane) + 10 Historic Era TPs (1950–2024).
  - Named Race Engineers (Lambiase, Bonnington, Bozzi, Adami, Joseph, Stallard, Jego...).
  - Data-deduced Driver profiles (aggression, FIA steward scrutiny, stress resilience, clout).
  - F1 Commission Political Voting Engine: AI TPs vote on Regulation Bills based on their
    team's real technical strengths, budget, leadership style, job stress, and player lobbying.
  - Realistic Executive Stress & Leadership-Style Sacking Model: multi-season underperformance
    vs. board targets and leadership-style friction can trigger realistic executive transitions
    (no cartoonish/unprofessional meltdowns).
"""
from __future__ import annotations

import copy
import sqlite3
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
F1DB_PATH = BASE_DIR / "data" / "f1db.sqlite"
FIA_DOCS_PATH = BASE_DIR / "data" / "fia_docs.sqlite"


LEADERSHIP_STYLES: dict[str, dict[str, Any]] = {
    "consensus_engineer": {
        "label": "Consensus Engineer",
        "desc": "Data-driven, calm technical delegation; high morale stability, cautious on radical rule gambles.",
        "risk_bias": -0.10,
        "cost_cap_bias": 0.25,
        "political_weight": 0.70,
        "board_patience": 3,
    },
    "works_technocrat": {
        "label": "Works Technocrat",
        "desc": "OEM-backed systems discipline; favors power-unit/ERS showcase formulas and large R&D structures.",
        "risk_bias": 0.05,
        "cost_cap_bias": -0.20,
        "political_weight": 0.90,
        "board_patience": 2,
    },
    "political_operator": {
        "label": "Political Operator",
        "desc": "Master of paddock coalitions and FIA lobbying; aggressively votes to disrupt rival advantages.",
        "risk_bias": 0.25,
        "cost_cap_bias": -0.15,
        "political_weight": 1.00,
        "board_patience": 2,
    },
    "pragmatic_rebuilder": {
        "label": "Pragmatic Rebuilder",
        "desc": "Long-horizon infrastructure builder; champions cost caps, parity rules, and steady operational climb.",
        "risk_bias": -0.05,
        "cost_cap_bias": 0.35,
        "political_weight": 0.72,
        "board_patience": 3,
    },
    "strict_autocrat": {
        "label": "Strict Autocrat",
        "desc": "High-accountability command structure; extracts sharp short-term gains but amplifies boardroom friction if results dip.",
        "risk_bias": 0.15,
        "cost_cap_bias": 0.05,
        "political_weight": 0.80,
        "board_patience": 2,
    },
}


TEAM_PRINCIPALS_2026: list[dict[str, Any]] = [
    {
        "id": "tp_wolff",
        "name": "Toto Wolff",
        "team": "Mercedes",
        "nationality": "AUT",
        "leadership_style": "works_technocrat",
        "strengths": {"aero": 86, "power": 93, "budget": 95, "chassis": 87},
        "target_wcc": 2,
        "job_stress": 34,
        "board_confidence": 82,
        "underperform_seasons": 0,
        "political_clout": 94,
        "voice_signature": "Direct, analytical Austrian executive; defends works powertrain excellence and operational discipline.",
        "quotes": {
            "yes": "From an engineering and commercial standpoint, this framework rewards genuine factory innovation. We support it.",
            "no": "This proposal penalizes works power-unit investment without improving the racing spectacle. Mercedes cannot endorse it.",
            "stress": "Our standards at Brackley and Brixworth are championship-level. A technical review is already underway.",
        },
    },
    {
        "id": "tp_vasseur",
        "name": "Frédéric Vasseur",
        "team": "Ferrari",
        "nationality": "FRA",
        "leadership_style": "pragmatic_rebuilder",
        "strengths": {"aero": 90, "power": 91, "budget": 96, "chassis": 88},
        "target_wcc": 1,
        "job_stress": 48,
        "board_confidence": 76,
        "underperform_seasons": 0,
        "political_clout": 96,
        "voice_signature": "Dry-humored, calm French racer shielding Maranello from external noise while guarding Ferrari's heritage veto.",
        "quotes": {
            "yes": "Let's stay pragmatic — the technical direction is sensible and keeps the racing honest. Scuderia Ferrari votes yes.",
            "no": "We have to look at the whole picture for Formula 1, not just one weekend. Maranello is voting against this bill.",
            "stress": "At Ferrari the expectation is always P1. We focus on execution in the factory, not headlines.",
        },
    },
    {
        "id": "tp_mekies",
        "name": "Laurent Mekies",
        "team": "Red Bull Racing",
        "nationality": "FRA",
        "leadership_style": "consensus_engineer",
        "strengths": {"aero": 94, "power": 88, "budget": 94, "chassis": 93},
        "target_wcc": 1,
        "job_stress": 44,
        "board_confidence": 79,
        "underperform_seasons": 0,
        "political_clout": 85,
        "voice_signature": "Former FIA safety director turned race-engineering leader; methodical on aerodynamics and regulatory clarity.",
        "quotes": {
            "yes": "The aerodynamic balance in this draft is clean and enforceable by the FIA scrutineers. Milton Keynes is in favour.",
            "no": "The technical wording introduces unnecessary wake instability and cost-cap distortion. Red Bull votes no.",
            "stress": "Integrating a new works power unit while defending titles creates real pressure, so we stay disciplined.",
        },
    },
    {
        "id": "tp_stella",
        "name": "Andrea Stella",
        "team": "McLaren",
        "nationality": "ITA",
        "leadership_style": "consensus_engineer",
        "strengths": {"aero": 95, "power": 91, "budget": 92, "chassis": 94},
        "target_wcc": 1,
        "job_stress": 28,
        "board_confidence": 90,
        "underperform_seasons": 0,
        "political_clout": 88,
        "voice_signature": "Measured Italian aerodynamics philosopher; speaks in probabilities, tyre energy, and high-trust team culture.",
        "quotes": {
            "yes": "Our simulation group confirms this formula rewards clean aerodynamic efficiency and fair competition. McLaren votes yes.",
            "no": "We believe stability and meritocratic aero development serve the sport better than this intervention. We vote no.",
            "stress": "When margins are tenths, we rely on process clarity rather than reactive decisions.",
        },
    },
    {
        "id": "tp_wheatley",
        "name": "Jonathan Wheatley",
        "team": "Aston Martin",
        "nationality": "GBR",
        "leadership_style": "political_operator",
        "strengths": {"aero": 88, "power": 87, "budget": 91, "chassis": 86},
        "target_wcc": 4,
        "job_stress": 41,
        "board_confidence": 77,
        "underperform_seasons": 0,
        "political_clout": 86,
        "voice_signature": "Razor-sharp sporting regulations specialist; spots loopholes in seconds and fights hard for Silverstone's title push.",
        "quotes": {
            "yes": "We've read every sub-clause with our technical directors — it opens a strong development window. Aston Martin votes yes.",
            "no": "As drafted, this locks in existing advantages and restricts our Silverstone wind-tunnel programme. We oppose it.",
            "stress": "With major investment in our campus, the board expects steady podium progression.",
        },
    },
    {
        "id": "tp_vowles",
        "name": "James Vowles",
        "team": "Williams",
        "nationality": "GBR",
        "leadership_style": "pragmatic_rebuilder",
        "strengths": {"aero": 80, "power": 90, "budget": 78, "chassis": 81},
        "target_wcc": 6,
        "job_stress": 32,
        "board_confidence": 84,
        "underperform_seasons": 0,
        "political_clout": 79,
        "voice_signature": "Articulate strategist obsessed with modernizing Grove's infrastructure and defending sustainable cost caps.",
        "quotes": {
            "yes": "This protects financial sustainability while letting independent teams compete on engineering merit. Williams supports it.",
            "no": "Escalating hardware costs in this proposal widen the gap between works giants and independents. Williams votes no.",
            "stress": "Transforming a historic team takes multi-year discipline; we won't compromise the foundations.",
        },
    },
    {
        "id": "tp_briatore",
        "name": "Flavio Briatore",
        "team": "Alpine",
        "nationality": "ITA",
        "leadership_style": "political_operator",
        "strengths": {"aero": 79, "power": 85, "budget": 82, "chassis": 80},
        "target_wcc": 6,
        "job_stress": 52,
        "board_confidence": 68,
        "underperform_seasons": 1,
        "political_clout": 89,
        "voice_signature": "Blunt commercial dealmaker who prioritizes showmanship, overtaking spectacle, and shaking up the established order.",
        "quotes": {
            "yes": "Good for the show, shakes up the grid, and gives Enstone a chance to jump the queue. Alpine votes yes.",
            "no": "Too conservative and expensive for no extra spectacle. We are not signing off on this.",
            "stress": "In Formula 1 nobody remembers sixth place — we need aggressive moves that pay off now.",
        },
    },
    {
        "id": "tp_komatsu",
        "name": "Ayao Komatsu",
        "team": "Haas",
        "nationality": "JPN",
        "leadership_style": "consensus_engineer",
        "strengths": {"aero": 78, "power": 88, "budget": 74, "chassis": 77},
        "target_wcc": 7,
        "job_stress": 36,
        "board_confidence": 81,
        "underperform_seasons": 0,
        "political_clout": 68,
        "voice_signature": "Hands-on race engineer focused on efficiency, tyre life, and lean cost-cap operations.",
        "quotes": {
            "yes": "Keeping complexity manageable under the cost cap helps smaller engineering groups like ours. Haas votes yes.",
            "no": "This adds manufacturing overhead that hurts lean teams far more than the top four. Haas votes no.",
            "stress": "Every dollar has to go onto the car, so operational mistakes hurt us twice as much.",
        },
    },
    {
        "id": "tp_binotto",
        "name": "Mattia Binotto",
        "team": "Audi",
        "nationality": "ITA",
        "leadership_style": "works_technocrat",
        "strengths": {"aero": 80, "power": 84, "budget": 90, "chassis": 81},
        "target_wcc": 7,
        "job_stress": 45,
        "board_confidence": 74,
        "underperform_seasons": 0,
        "political_clout": 83,
        "voice_signature": "Powertrain-first Swiss-Italian engineer building Audi's Neuburg/Hinwil works project with 50/50 hybrid ambition.",
        "quotes": {
            "yes": "A strong electrical and aerodynamic platform aligns directly with Audi's works roadmap. We vote yes.",
            "no": "Changing core technical parameters mid-cycle undermines our multi-year works investment. Audi votes no.",
            "stress": "Launching a full works operation demands patience from the board, though expectations are rising.",
        },
    },
    {
        "id": "tp_lowdon",
        "name": "Graeme Lowdon",
        "team": "Cadillac",
        "nationality": "GBR",
        "leadership_style": "pragmatic_rebuilder",
        "strengths": {"aero": 76, "power": 84, "budget": 85, "chassis": 78},
        "target_wcc": 9,
        "job_stress": 39,
        "board_confidence": 80,
        "underperform_seasons": 0,
        "political_clout": 72,
        "voice_signature": "Steady operational builder guiding Formula 1's newest American works entrant through its maiden campaigns.",
        "quotes": {
            "yes": "Clear, forward-looking rules that give a new constructor room to innovate get Cadillac's vote.",
            "no": "This skews too heavily toward legacy wind-tunnel data. Cadillac votes against.",
            "stress": "As a new grid entry, delivering reliable finishes and steady points growth is priority one.",
        },
    },
    {
        "id": "tp_permane",
        "name": "Alan Permane",
        "team": "Racing Bulls",
        "nationality": "GBR",
        "leadership_style": "strict_autocrat",
        "strengths": {"aero": 82, "power": 86, "budget": 80, "chassis": 82},
        "target_wcc": 6,
        "job_stress": 38,
        "board_confidence": 78,
        "underperform_seasons": 0,
        "political_clout": 74,
        "voice_signature": "35-year trackside veteran; no-nonsense race execution and sharp mechanical pragmatism.",
        "quotes": {
            "yes": "Simple, raceable rules that let drivers attack on track — Racing Bulls backs this bill.",
            "no": "Overcomplicated gimmicks that add weight and pit-wall headaches. We vote no.",
            "stress": "Midfield margins are brutal; execution every Sunday decides who keeps their seat.",
        },
    },
]


HISTORIC_TPS: list[dict[str, Any]] = [
    {"id": "tp_enzo", "name": "Enzo Ferrari", "team": "Ferrari", "eras": (1950, 1988), "leadership_style": "strict_autocrat", "voice_signature": "Aerodynamics are for people who cannot build engines."},
    {"id": "tp_chapman", "name": "Colin Chapman", "team": "Lotus", "eras": (1958, 1982), "leadership_style": "political_operator", "voice_signature": "Simplify, then add lightness."},
    {"id": "tp_tyrrell", "name": "Ken Tyrrell", "team": "Tyrrell", "eras": (1970, 1998), "leadership_style": "pragmatic_rebuilder", "voice_signature": "Woodyard ingenuity and fierce independent spirit."},
    {"id": "tp_ecclestone", "name": "Bernie Ecclestone", "team": "Brabham", "eras": (1972, 1987), "leadership_style": "political_operator", "voice_signature": "Master dealmaker who turned F1 into a global empire."},
    {"id": "tp_williams", "name": "Frank Williams", "team": "Williams", "eras": (1977, 2012), "leadership_style": "strict_autocrat", "voice_signature": "Relentless racer who prioritized pure engineering speed above politics."},
    {"id": "tp_dennis", "name": "Ron Dennis", "team": "McLaren", "eras": (1981, 2009), "leadership_style": "works_technocrat", "voice_signature": "Obsessive perfectionist ('Ronspeak') and pioneer of carbon-fibre professionalism."},
    {"id": "tp_jordan", "name": "Eddie Jordan", "team": "Jordan", "eras": (1991, 2005), "leadership_style": "political_operator", "voice_signature": "Charismatic rock-and-roll underdog with an eye for rookie superstars."},
    {"id": "tp_todt", "name": "Jean Todt", "team": "Ferrari", "eras": (1993, 2007), "leadership_style": "consensus_engineer", "voice_signature": "Tireless French architect of Maranello's golden era."},
    {"id": "tp_brawn", "name": "Ross Brawn", "team": "Brawn / Mercedes", "eras": (2009, 2013), "leadership_style": "consensus_engineer", "voice_signature": "Calm tactical mastermind of the double-diffuser fairytale."},
    {"id": "tp_horner", "name": "Christian Horner", "team": "Red Bull Racing", "eras": (2005, 2025), "leadership_style": "political_operator", "voice_signature": "Combative paddock tactician thriving on mind games and bold strategy."},
]


RACE_ENGINEERS_2026: list[dict[str, Any]] = [
    {"id": "eng_gp", "name": "Gianpiero Lambiase", "team": "Red Bull Racing", "driver": "Max Verstappen", "style": "Blunt & Unflappable", "stress_tolerance": 94, "signature": "Copy Max, keep your head down — we'll manage the gaps."},
    {"id": "eng_bono", "name": "Peter Bonnington", "team": "Mercedes", "driver": "Kimi Antonelli", "style": "Calm Mentor", "stress_tolerance": 92, "signature": "Hammer time when you're ready — smooth on the exits."},
    {"id": "eng_bozzi", "name": "Bryan Bozzi", "team": "Ferrari", "driver": "Charles Leclerc", "style": "Precise & Direct", "stress_tolerance": 86, "signature": "Plan B confirmed, target minus two on the delta."},
    {"id": "eng_adami", "name": "Riccardo Adami", "team": "Ferrari", "driver": "Lewis Hamilton", "style": "Methodical Veteran", "stress_tolerance": 88, "signature": "Mode Push available, watch rear-left surface temp in Turn 9."},
    {"id": "eng_joseph", "name": "Will Joseph", "team": "McLaren", "driver": "Lando Norris", "style": "Reassuring Strategist", "stress_tolerance": 89, "signature": "Good pace Lando, keep doing what you're doing — gap behind is growing."},
    {"id": "eng_stallard", "name": "Tom Stallard", "team": "McLaren", "driver": "Oscar Piastri", "style": "Clinical Olympic Calm", "stress_tolerance": 95, "signature": "Clean lap Oscar. Tyre wear is better than predicted."},
    {"id": "eng_dudley", "name": "Marcus Dudley", "team": "Mercedes", "driver": "George Russell", "style": "Analytical Data Lead", "stress_tolerance": 87, "signature": "Forecast shows rain in 11 minutes; stay out unless grip drops off."},
    {"id": "eng_jego", "name": "Gaëtan Jego", "team": "Williams", "driver": "Carlos Sainz", "style": "Collaborative Tactician", "stress_tolerance": 85, "signature": "Copy Carlos, we agree — undercut window opens in two laps."},
]


SUCCESSOR_POOL: list[dict[str, str]] = [
    {"name": "Otmar Szafnauer", "nationality": "USA", "leadership_style": "pragmatic_rebuilder"},
    {"name": "Mike Krack", "nationality": "LUX", "leadership_style": "consensus_engineer"},
    {"name": "Andreas Seidl", "nationality": "DEU", "leadership_style": "works_technocrat"},
    {"name": "Marcin Budkowski", "nationality": "POL", "leadership_style": "consensus_engineer"},
    {"name": "Bruno Famin", "nationality": "FRA", "leadership_style": "works_technocrat"},
    {"name": "Guenther Steiner", "nationality": "ITA", "leadership_style": "strict_autocrat"},
]


def initial_tp_roster() -> list[dict[str, Any]]:
    """Return a fresh deep-copied list of the 11 real 2026 Team Principals."""
    return copy.deepcopy(TEAM_PRINCIPALS_2026)


def _deduce_driver_politics_from_dbs(year: int) -> list[dict[str, Any]]:
    """Query f1db.sqlite & fia_docs.sqlite to deduce per-season driver temperament & steward heat."""
    out: list[dict[str, Any]] = []
    steward_counts: dict[str, int] = {}

    if FIA_DOCS_PATH.exists():
        try:
            con = sqlite3.connect(str(FIA_DOCS_PATH))
            con.row_factory = sqlite3.Row
            rows = con.execute(
                "SELECT title, summary FROM fia_docs WHERE year BETWEEN ? AND ? AND (title LIKE '%Infringement%' OR title LIKE '%Decision%' OR title LIKE '%Penalty%') LIMIT 400",
                (max(2018, year - 2), min(2026, year)),
            ).fetchall()
            for r in rows:
                txt = f"{r['title'] or ''} {r['summary'] or ''}".lower()
                for surname in ("verstappen", "hamilton", "leclerc", "norris", "piastri", "russell", "alonso", "sainz", "albon", "gasly", "ocon", "tsunoda", "stroll", "hulkenberg", "bearman", "antonelli", "hadjar", "lawson", "bortoleto"):
                    if surname in txt:
                        steward_counts[surname] = steward_counts.get(surname, 0) + 1
            con.close()
        except Exception:
            pass

    if F1DB_PATH.exists():
        try:
            con = sqlite3.connect(str(F1DB_PATH))
            con.row_factory = sqlite3.Row
            q = con.execute(
                """
                SELECT d.name AS driver_name,
                       d.nationality_country_id AS nat,
                       COUNT(r.id) AS starts,
                       SUM(CASE WHEN r.position_number = 1 THEN 1 ELSE 0 END) AS wins,
                       SUM(CASE WHEN r.position_number <= 3 THEN 1 ELSE 0 END) AS podiums,
                       SUM(CASE WHEN r.position_text IN ('DNF','DSQ','RET') OR r.position_number IS NULL THEN 1 ELSE 0 END) AS dnfs
                FROM race_data r
                JOIN race ra ON ra.id = r.race_id
                JOIN driver d ON d.id = r.driver_id
                WHERE ra.year = ? AND r.type = 'RACE_RESULT'
                GROUP BY d.id
                ORDER BY wins DESC, podiums DESC, starts DESC
                LIMIT 22
                """,
                (year,),
            ).fetchall()
            for r in q:
                name = str(r["driver_name"] or "")
                low = name.lower()
                starts = max(1, int(r["starts"] or 1))
                wins = int(r["wins"] or 0)
                podiums = int(r["podiums"] or 0)
                dnfs = int(r["dnfs"] or 0)
                heat = 0
                for k, v in steward_counts.items():
                    if k in low:
                        heat = v
                        break
                dnf_rate = dnfs / starts
                podium_rate = podiums / starts
                aggression = int(max(42, min(97, 58 + heat * 2.5 + dnf_rate * 45 + (10 if wins >= 3 else 0))))
                resilience = int(max(48, min(98, 66 + podium_rate * 32 - dnf_rate * 22)))
                clout = int(max(45, min(99, 52 + wins * 4.5 + podiums * 1.4)))
                archetype = (
                    "Clinical Champion" if wins >= 4 else
                    ("Hard Racer" if aggression >= 78 else
                     ("Composed Qualifier" if resilience >= 76 else "Midfield Fighter"))
                )
                out.append({
                    "name": name,
                    "nationality": str(r["nat"] or "").upper()[:3],
                    "starts": starts,
                    "wins": wins,
                    "podiums": podiums,
                    "steward_incidents": heat,
                    "aggression": aggression,
                    "stress_resilience": resilience,
                    "political_clout": clout,
                    "archetype": archetype,
                })
            con.close()
        except Exception:
            pass

    return out


def get_season_paddock_bundle(year: int = 2026) -> dict[str, Any]:
    """Return Team Principals, Race Engineers & F1DB/FIA-deduced Driver Profiles for any season (for /sim & /career)."""
    y = int(year or 2026)
    if y >= 2025:
        tps = initial_tp_roster()
        engineers = copy.deepcopy(RACE_ENGINEERS_2026)
    else:
        tps = []
        for h in HISTORIC_TPS:
            lo, hi = h["eras"]
            if lo <= y <= hi:
                item = copy.deepcopy(h)
                item["job_stress"] = 35
                item["board_confidence"] = 78
                item["political_clout"] = 85
                tps.append(item)
        if not tps:
            tps = copy.deepcopy(HISTORIC_TPS[:5])
        engineers = copy.deepcopy(RACE_ENGINEERS_2026[:4])

    drivers = _deduce_driver_politics_from_dbs(y)
    return {
        "year": y,
        "team_principals": tps,
        "race_engineers": engineers,
        "driver_profiles": drivers,
        "leadership_styles": LEADERSHIP_STYLES,
    }


def evaluate_commission_bill(
    tp_roster: list[dict[str, Any]],
    formula_eval: dict[str, Any],
    lobbied_tp_ids: list[str] | None = None,
    player_team_name: str = "Player Team",
) -> dict[str, Any]:
    """Simulate an F1 Commission vote where AI Team Principals vote on a Regulation Bill."""
    lobbied = set(lobbied_tp_ids or [])
    f = formula_eval.get("formula") or {}
    dims = f.get("dimensions") or {}
    pt = f.get("powertrain") or {}
    gov = f.get("governance") or {}
    metrics = formula_eval.get("metrics") or {}
    tools = set(f.get("active_tools") or [])

    cost_cap = float(gov.get("cost_cap_m", 135))
    ers_kw = float(pt.get("ers_kw", 350))
    cornering = float(metrics.get("cornering_index", 75))
    overtake_s = float(metrics.get("overtake_delta_s", 0.5))
    dnf_mult = float(metrics.get("reliability_dnf_mult", 1.0))
    has_radical_tool = bool(tools & {"fan_car", "six_wheeler"}) or bool(f.get("custom_tools"))

    votes: list[dict[str, Any]] = []
    yes_count = 1  # Player's own vote
    no_count = 0

    for tp in tp_roster:
        style_key = tp.get("leadership_style") or "consensus_engineer"
        style = LEADERSHIP_STYLES.get(style_key, LEADERSHIP_STYLES["consensus_engineer"])
        st = tp.get("strengths") or {"aero": 80, "power": 80, "budget": 80, "chassis": 80}
        stress = float(tp.get("job_stress", 35))

        score = 0.08  # Slight baseline openness to constructive regulation evolution
        reasons: list[str] = []

        # 1. Cost cap vs team budget strength
        budget = float(st.get("budget", 82))
        if budget <= 82 and cost_cap <= 140:
            score += 0.28
            reasons.append("protects lean cost-cap parity")
        elif budget <= 82 and cost_cap > 165:
            score -= 0.34
            reasons.append("cost cap rise favors factory giants")
        elif budget >= 92 and cost_cap >= 150:
            score += 0.22
            reasons.append("unlocks factory R&D headroom")
        elif budget >= 92 and cost_cap < 120:
            score -= 0.28
            reasons.append("tight cost cap squeezes works infrastructure")

        # 2. Powertrain ERS vs team power strength
        if float(st.get("power", 82)) >= 90 and ers_kw >= 320:
            score += 0.22
            reasons.append("rewards works hybrid powertrain")
        elif float(st.get("power", 82)) < 85 and ers_kw >= 400:
            score -= 0.18
            reasons.append("heavy hybrid load exposes PU deficit")

        # 3. Aero & radical tools vs leadership style
        if float(st.get("aero", 82)) >= 90 and cornering >= 78:
            score += 0.18
            reasons.append("amplifies chassis aero efficiency")
        if has_radical_tool:
            score += float(style["risk_bias"]) * 1.15
            if style["risk_bias"] > 0:
                reasons.append("backs disruptive Car Tool reset")
            else:
                reasons.append("wary of radical Car Tool complexity")

        # 4. Racing spectacle & reliability pragmatism
        if overtake_s >= 0.65:
            score += 0.10
        if dnf_mult >= 1.30:
            score -= 0.16
            reasons.append("high DNF risk from mechanical strain")

        # 5. Realistic Job-Stress modifier: stressed TPs vote defensively to protect survival or disrupt leaders
        if stress >= 60:
            if budget < 85 and has_radical_tool:
                score += 0.14  # Under-pressure midfield TP gambles on rule reset
                reasons.append("seeking rule reset under board pressure")
            elif budget >= 90:
                score -= 0.14  # Under-pressure top-team TP fears losing ground
                reasons.append("cautious amid boardroom scrutiny")

        # 6. Player diplomatic lobbying
        was_lobbied = tp.get("id") in lobbied
        if was_lobbied:
            score += 0.34
            reasons.append(f"swayed by {player_team_name} lobbying")

        vote_str = "YES" if score >= 0.08 else "NO"
        if vote_str == "YES":
            yes_count += 1
        else:
            no_count += 1

        qmap = tp.get("quotes") or {}
        quote = qmap.get("yes") if vote_str == "YES" else qmap.get("no")
        if not quote:
            quote = "We back the technical direction." if vote_str == "YES" else "We cannot support this draft."

        votes.append({
            "tp_id": tp.get("id"),
            "name": tp.get("name"),
            "team": tp.get("team"),
            "leadership_style": style_key,
            "leadership_label": style["label"],
            "job_stress": int(round(stress)),
            "lobbied": was_lobbied,
            "vote": vote_str,
            "score": round(score, 2),
            "reason": "; ".join(reasons[:2]) or "balanced sporting evaluation",
            "quote": quote,
        })

    # FIA Sporting Delegate casting vote (favors clean air + safe reliability + balanced cost cap)
    fia_yes = (float(metrics.get("clean_air_score", 60)) >= 45.0 and dnf_mult <= 1.55)
    if fia_yes:
        yes_count += 1
    else:
        no_count += 1

    total_votes = yes_count + no_count
    needed = max(7, int(total_votes * 0.58))
    passed = yes_count >= needed

    return {
        "passed": passed,
        "yes_count": yes_count,
        "no_count": no_count,
        "needed": needed,
        "fia_vote": "YES" if fia_yes else "NO",
        "player_vote": "YES",
        "votes": votes,
        "summary": (
            f"BILL PASSED ({yes_count}–{no_count}, threshold {needed}): '{f.get('name', 'Formula')}' ratified for upcoming Championship & Sim Library!"
            if passed else
            f"BILL REJECTED ({yes_count}–{no_count}, needed {needed}): Paddock coalition blocked the bill — lobby key TPs or adjust cost cap / Car Tools."
        ),
    }


def step_paddock_stress(
    tp_roster: list[dict[str, Any]],
    team_standings_order: list[str] | None = None,
    season_end: bool = False,
) -> dict[str, Any]:
    """Update AI Team Principal job stress & board confidence realistically after races / seasons.

    Leadership-style clashes + multi-season underperformance trigger realistic executive transitions
    (mutual parting of ways / board review) rather than cartoonish meltdowns.
    """
    pos_map: dict[str, int] = {}
    if team_standings_order:
        for idx, tname in enumerate(team_standings_order, start=1):
            pos_map[tname.lower()] = idx

    events: list[dict[str, Any]] = []
    used_names = {tp.get("name") for tp in tp_roster}

    for tp in tp_roster:
        tlow = str(tp.get("team") or "").lower()
        pos = None
        for k, v in pos_map.items():
            if tlow in k or k in tlow:
                pos = v
                break
        if pos is None:
            continue

        target = int(tp.get("target_wcc", 5))
        deficit = pos - target  # positive = underperforming target
        style_key = tp.get("leadership_style") or "consensus_engineer"
        style = LEADERSHIP_STYLES.get(style_key, LEADERSHIP_STYLES["consensus_engineer"])
        stress = float(tp.get("job_stress", 35))
        conf = float(tp.get("board_confidence", 78))

        # Realistic leadership-style friction multiplier when underperforming
        friction_mult = 1.28 if style_key == "strict_autocrat" else (1.18 if style_key == "political_operator" else 0.92)

        if deficit > 0:
            step = (3.5 + deficit * 2.4) * friction_mult * (1.8 if season_end else 0.55)
            stress = min(98.0, stress + step)
            conf = max(8.0, conf - step * 0.95)
        elif deficit < 0:
            relief = (2.5 + abs(deficit) * 1.8) * (1.5 if season_end else 0.5)
            stress = max(12.0, stress - relief)
            conf = min(98.0, conf + relief * 0.85)
        else:
            stress = max(18.0, stress - 1.0)
            conf = min(92.0, conf + 0.8)

        if season_end:
            if deficit >= 2:
                tp["underperform_seasons"] = int(tp.get("underperform_seasons", 0)) + 1
            elif deficit <= 0:
                tp["underperform_seasons"] = 0

        tp["job_stress"] = int(round(stress))
        tp["board_confidence"] = int(round(conf))

        # Check realistic executive transition (2+ consecutive bad seasons OR sustained board confidence collapse)
        patience = int(style.get("board_patience", 2))
        if (season_end and int(tp.get("underperform_seasons", 0)) >= patience and conf < 38) or (conf <= 16 and stress >= 86):
            old_name = tp.get("name", "Team Principal")
            old_style = style["label"]
            successor = next((s for s in SUCCESSOR_POOL if s["name"] not in used_names), SUCCESSOR_POOL[0])
            used_names.add(successor["name"])
            tp["name"] = successor["name"]
            tp["nationality"] = successor["nationality"]
            tp["leadership_style"] = successor["leadership_style"]
            tp["job_stress"] = 26
            tp["board_confidence"] = 76
            tp["underperform_seasons"] = 0
            new_style_label = LEADERSHIP_STYLES[successor["leadership_style"]]["label"]
            events.append({
                "type": "executive_transition",
                "team": tp.get("team"),
                "outgoing": old_name,
                "incoming": successor["name"],
                "headline": f"{tp.get('team')} Executive Transition: {old_name} departs following board performance review; {successor['name']} appointed Team Principal.",
                "detail": f"After sustained WCC underperformance and {old_style.lower()} friction with the board, {tp.get('team')} shifted to a {new_style_label} leadership model.",
            })

    return {"tp_roster": tp_roster, "events": events}
