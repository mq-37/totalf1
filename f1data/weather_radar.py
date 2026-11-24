"""
Real-Time Circuit Weather, Pit-Wall Doppler Radar & R&D-Calibrated Optimal Pit/Crossover Calculator.

Connects to live real-world meteorological data via Open-Meteo (free, keyless, 15-min cache with
automatic climatological fallback) for every F1 circuit's real GPS coordinates, generates moving
Doppler precipitation radar cells driven by real wind vectors, and computes optimal dry/wet pit
windows & Slick<->Inter<->Wet crossover laps calibrated by Career R&D Tyre-Care & FP Strategy Intel.
"""
from __future__ import annotations

import math
import random
import sqlite3
import time
from pathlib import Path
from typing import Any

import requests

BASE_DIR = Path(__file__).resolve().parent.parent
F1DB_PATH = BASE_DIR / "data" / "f1db.sqlite"

# Exact GPS (latitude, longitude) for modern 2026 & iconic historic F1 venues
CIRCUIT_GPS: dict[str, tuple[float, float]] = {
    "melbourne": (-37.8497, 144.9680),
    "shanghai": (31.3389, 121.2197),
    "suzuka": (34.8431, 136.5410),
    "bahrain": (26.0325, 50.5106),
    "jeddah": (21.6319, 39.1044),
    "miami": (25.9581, -80.2389),
    "imola": (44.3439, 11.7167),
    "monaco": (43.7347, 7.4206),
    "montreal": (45.5000, -73.5228),
    "barcelona": (41.5700, 2.2611),
    "madrid": (40.4660, -3.6168),
    "spielberg": (47.2197, 14.7647),
    "silverstone": (52.0786, -1.0169),
    "spa": (50.4372, 5.9714),
    "budapest": (47.5789, 19.2486),
    "zandvoort": (52.3888, 4.5409),
    "monza": (45.6156, 9.2811),
    "baku": (40.3725, 49.8533),
    "singapore": (1.2914, 103.8640),
    "austin": (30.1328, -97.6411),
    "mexico": (19.4042, -99.0907),
    "interlagos": (-23.7036, -46.6997),
    "vegas": (36.1147, -115.1728),
    "lusail": (25.4900, 51.4542),
    "abudhabi": (24.4672, 54.6031),
    "nurburgring": (50.3356, 6.9475),
    "hockenheim": (49.3278, 8.5656),
    "istanbul": (40.9517, 29.4050),
    "sepang": (2.7608, 101.7381),
    "portimao": (37.2270, -8.6267),
    "mugello": (43.9975, 11.3719),
    "kyalami": (-25.9986, 28.0694),
    "adelaide": (-34.9272, 138.6172),
    "paulricard": (43.2506, 5.7917),
    "fuji": (35.3717, 138.9267),
    "indianapolis": (39.7950, -86.2347),
    "jerez": (36.7083, -6.0342),
    "estoril": (38.7506, -9.3942),
    "magnycours": (46.8642, 3.1636),
    "brandshatch": (51.3569, 0.2631),
    "watkinsglen": (42.3369, -76.9272),
}

WMO_LABELS: dict[int, tuple[str, str]] = {
    0: ("Clear Sky", "dry"),
    1: ("Mainly Clear", "dry"),
    2: ("Partly Cloudy", "dry"),
    3: ("Overcast", "cloudy"),
    45: ("Track Fog", "cloudy"),
    48: ("Rime Fog", "cloudy"),
    51: ("Light Drizzle", "showers"),
    53: ("Moderate Drizzle", "showers"),
    55: ("Dense Drizzle", "showers"),
    61: ("Light Rain", "showers"),
    63: ("Moderate Rain", "rain"),
    65: ("Heavy Rain", "rain"),
    80: ("Passing Showers", "showers"),
    81: ("Moderate Showers", "rain"),
    82: ("Violent Showers", "rain"),
    95: ("Thunderstorm", "rain"),
    96: ("Storm & Hail", "rain"),
}

_LIVE_WEATHER_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_S = 900.0  # 15 minutes


def _resolve_circuit_gps(circuit_id: str, circuit_name: str = "") -> tuple[float, float]:
    cid = str(circuit_id or "").strip().lower()
    if cid in CIRCUIT_GPS:
        return CIRCUIT_GPS[cid]
    for k, coords in CIRCUIT_GPS.items():
        if k in cid or cid in k:
            return coords
    # Secondary lookup from f1db.sqlite if present
    if F1DB_PATH.exists():
        try:
            con = sqlite3.connect(str(F1DB_PATH))
            row = con.execute(
                "SELECT latitude, longitude FROM circuits WHERE lower(id) LIKE ? OR lower(name) LIKE ? LIMIT 1",
                (f"%{cid}%", f"%{(circuit_name or cid).lower()[:12]}%"),
            ).fetchone()
            con.close()
            if row and row[0] is not None and row[1] is not None:
                return (float(row[0]), float(row[1]))
        except Exception:
            pass
    return (52.0786, -1.0169)  # Silverstone default


def _wind_cardinal(deg: float) -> str:
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[int(((deg % 360) + 22.5) // 45) % 8]


def fetch_live_circuit_weather(circuit: dict[str, Any]) -> dict[str, Any]:
    """Fetch real-time weather from Open-Meteo for the circuit's GPS (15-min TTL cache + fallback)."""
    cid = str(circuit.get("id") or "melbourne")
    now = time.time()
    cached = _LIVE_WEATHER_CACHE.get(cid)
    if cached and (now - cached[0]) < _CACHE_TTL_S:
        return dict(cached[1])

    lat, lon = _resolve_circuit_gps(cid, str(circuit.get("name") or ""))
    is_night = bool(circuit.get("is_night"))

    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat:.4f}&longitude={lon:.4f}"
            f"&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m"
            f"&hourly=precipitation_probability,precipitation,rain,temperature_2m,wind_speed_10m"
            f"&forecast_days=1"
        )
        r = requests.get(url, timeout=3.5, headers={"User-Agent": "TRAF1-PitWall/2.0"})
        if r.status_code == 200:
            j = r.json()
            cur = j.get("current") or {}
            hr = j.get("hourly") or {}
            air_c = float(cur.get("temperature_2m", 21.0))
            clouds = float(cur.get("cloud_cover", 35.0))
            precip_mm = float(cur.get("precipitation", 0.0) or cur.get("rain", 0.0) or 0.0)
            wcode = int(cur.get("weather_code", 0) or 0)
            wind_kph = float(cur.get("wind_speed_10m", 14.0))
            wind_deg = float(cur.get("wind_direction_10m", 225.0))
            humid = int(round(float(cur.get("relative_humidity_2m", 55.0))))

            # Track temperature model: asphalt absorbs solar load when clear & daytime
            solar_gain = (0.0 if is_night else (16.0 * (1.0 - clouds / 120.0))) - min(6.0, precip_mm * 2.5)
            track_c = round(air_c + max(2.0, solar_gain), 1)
            cond_lbl, cond_cat = WMO_LABELS.get(wcode, ("Scattered Clouds", "dry"))

            # Next 6 hours precipitation probabilities & mm/hr
            probs = (hr.get("precipitation_probability") or [])[:12]
            mms = (hr.get("precipitation") or [])[:12]
            peak_prob = max([int(p or 0) for p in probs] or [int(circuit.get("rain_chance") or 20)])

            payload = {
                "source": "Open-Meteo Live",
                "live": True,
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "air_temp_c": round(air_c, 1),
                "track_temp_c": track_c,
                "humidity_pct": humid,
                "cloud_cover_pct": int(round(clouds)),
                "precip_mm_hr": round(precip_mm, 2),
                "rain_prob_pct": peak_prob,
                "wind_kph": round(wind_kph, 1),
                "wind_deg": int(round(wind_deg)),
                "wind_dir": _wind_cardinal(wind_deg),
                "weather_code": wcode,
                "condition": cond_lbl,
                "category": cond_cat,
                "hourly_prob": [int(p or 0) for p in probs[:6]],
                "hourly_mm": [round(float(m or 0.0), 2) for m in mms[:6]],
            }
            _LIVE_WEATHER_CACHE[cid] = (now, payload)
            return dict(payload)
    except Exception:
        pass

    # Deterministic realistic climatology fallback (offline-safe!)
    rain_ch = int(circuit.get("rain_chance") or 25)
    t_temp = float(circuit.get("track_temp_c") or 31.0)
    air_c = round(t_temp - (6.0 if is_night else 11.0), 1)
    rng = random.Random(hash(cid) % 100000 + int(now // 3600))
    wind_deg = rng.randint(0, 359)
    wind_kph = round(rng.uniform(8.0, 26.0), 1)
    precip_mm = round(rng.uniform(0.6, 3.2), 2) if rain_ch >= 50 else 0.0
    payload = {
        "source": "Pit-Wall Climatology Model",
        "live": False,
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "air_temp_c": air_c,
        "track_temp_c": round(t_temp, 1),
        "humidity_pct": min(95, 42 + rain_ch // 2),
        "cloud_cover_pct": min(95, 20 + rain_ch),
        "precip_mm_hr": precip_mm,
        "rain_prob_pct": rain_ch,
        "wind_kph": wind_kph,
        "wind_deg": wind_deg,
        "wind_dir": _wind_cardinal(wind_deg),
        "weather_code": 61 if precip_mm > 0 else 2,
        "condition": "Passing Showers" if precip_mm > 0 else "Partly Cloudy",
        "category": "showers" if precip_mm > 0 else "dry",
        "hourly_prob": [rain_ch, min(100, rain_ch + 8), max(5, rain_ch - 6), rain_ch, max(5, rain_ch - 10), rain_ch],
        "hourly_mm": [precip_mm, round(precip_mm * 1.2, 2), round(precip_mm * 0.6, 2), 0.0, 0.0, 0.0],
    }
    _LIVE_WEATHER_CACHE[cid] = (now, payload)
    return dict(payload)


def build_weather_radar_and_pit_plan(
    circuit: dict[str, Any],
    mode: str = "dynamic",
    laps: int = 15,
    intel_pct: int = 70,
    tyre_care: float = 80.0,
) -> dict[str, Any]:
    """Combine live Open-Meteo weather, Pit-Wall Doppler Radar cells & R&D-calibrated Optimal Pit/Crossover math."""
    live = fetch_live_circuit_weather(circuit)
    m = (mode or "dynamic").strip().lower()
    intel = max(30, min(100, int(intel_pct)))
    t_care = max(55.0, min(99.0, float(tyre_care)))
    total_laps = max(5, min(78, int(laps or 15)))

    # Determine effective race rainfall profile (12 timeline buckets across race distance)
    rng = random.Random(hash((circuit.get("id"), m, total_laps)) % 999983)
    timeline: list[dict[str, Any]] = []

    if m == "dry":
        base_mm = [0.0] * 12
    elif m == "rain":
        base_mm = [round(3.8 + rng.uniform(-0.8, 2.2), 2) for _ in range(12)]
    elif m == "showers":
        # Incoming shower band mid-race then drying!
        peak_idx = rng.randint(3, 6)
        base_mm = []
        for i in range(12):
            dist = abs(i - peak_idx)
            mm = max(0.0, round((3.4 - dist * 0.95) + rng.uniform(-0.2, 0.4), 2))
            base_mm.append(mm)
    elif m == "real_live":
        cur_mm = float(live.get("precip_mm_hr") or 0.0)
        h_mm = live.get("hourly_mm") or [cur_mm] * 6
        h_pr = live.get("hourly_prob") or [int(live.get("rain_prob_pct") or 20)] * 6
        base_mm = []
        for i in range(12):
            hi = min(len(h_mm) - 1, i // 2)
            mm = float(h_mm[hi] or 0.0)
            if mm <= 0.01 and int(h_pr[hi] or 0) >= 55:
                mm = round((int(h_pr[hi]) - 45) * 0.05, 2)
            base_mm.append(round(mm, 2))
    else:
        # Dynamic: uses real circuit rain_chance & live probability
        prob = max(int(circuit.get("rain_chance") or 20), int(live.get("rain_prob_pct") or 20))
        if prob >= 40:
            peak_idx = rng.randint(4, 8)
            base_mm = [
                max(0.0, round(((prob / 22.0) - abs(i - peak_idx) * 0.72), 2))
                for i in range(12)
            ]
        else:
            base_mm = [0.0] * 12

    # Convert mm/hr + wind drying into progressive track wetness % (0..100) across the race
    wet = 42.0 if m == "rain" else (min(65.0, float(base_mm[0]) * 18.0))
    dry_rate = 3.2 + (float(live.get("wind_kph") or 12.0) * 0.14) + max(0.0, (float(live.get("track_temp_c") or 28.0) - 20.0) * 0.18)

    for i in range(12):
        mm = base_mm[i]
        if mm > 0.05:
            wet = min(100.0, wet + mm * 11.5)
        else:
            wet = max(0.0, wet - dry_rate)
        lap_num = max(1, min(total_laps, int(round((i / 11.0) * (total_laps - 1))) + 1))
        timeline.append({
            "step": i,
            "minute": i * 5,
            "lap": lap_num,
            "mm_hr": mm,
            "wetness_pct": int(round(wet)),
            "ideal_tyre": "W" if wet >= 68 else ("I" if wet >= 28 else "S/M"),
        })

    # Generate Doppler Radar Storm Cells moving along real wind vector!
    wind_rad = math.radians((float(live.get("wind_deg") or 225.0) + 180.0) % 360.0)
    wind_spd = max(0.35, min(2.2, float(live.get("wind_kph") or 14.0) / 14.0))
    vx = round(math.cos(wind_rad) * wind_spd * 0.45, 3)
    vy = round(math.sin(wind_rad) * wind_spd * 0.45, 3)

    cells: list[dict[str, Any]] = []
    peak_mm = max(base_mm) if base_mm else 0.0
    if peak_mm > 0.08:
        n_cells = 5 if peak_mm >= 2.2 else 3
        for ci in range(n_cells):
            inten = round(max(0.4, peak_mm * rng.uniform(0.55, 1.35)), 2)
            dbz = int(min(62, 22 + inten * 9.5))
            # Position upwind so cells sweep across the circuit center!
            dist_up = rng.uniform(0.15, 0.85)
            spread = rng.uniform(-0.42, 0.42)
            cx = -math.cos(wind_rad) * dist_up - math.sin(wind_rad) * spread
            cy = -math.sin(wind_rad) * dist_up + math.cos(wind_rad) * spread
            cells.append({
                "id": f"cell_{ci}",
                "x": round(cx, 3),
                "y": round(cy, 3),
                "vx": vx,
                "vy": vy,
                "radius": round(rng.uniform(0.16, 0.34), 3),
                "mm_hr": inten,
                "dbz": dbz,
            })

    # R&D + FP Intel Optimal Pit-Stop & Tyre Crossover Calculator!
    # Higher Car R&D Tyre Care extends stint life; higher Track Temp increases deg.
    base_deg = float(circuit.get("tyre_deg_s") or 0.068)
    temp_mult = 1.0 + max(-0.15, min(0.32, (float(live.get("track_temp_c") or 30.0) - 30.0) * 0.015))
    rd_tyre_mult = 1.0 - (t_care - 78.0) * 0.0085  # e.g. 95 tyre_care -> 0.855x tyre deg!
    eff_deg = round(max(0.032, base_deg * temp_mult * rd_tyre_mult), 4)
    pit_loss = float(circuit.get("pit_loss_s") or 21.5)
    uncertainty_laps = round(max(0.0, (100 - intel) * 0.045), 1)

    start_wet = timeline[0]["wetness_pct"]
    start_tyre = "W" if start_wet >= 68 else ("I" if start_wet >= 28 else ("M" if eff_deg >= 0.070 else "S"))

    pit_stops: list[dict[str, Any]] = []
    crossover_alerts: list[str] = []

    # Detect wet/dry crossover points from the radar timeline
    prev_band = "W" if start_wet >= 68 else ("I" if start_wet >= 28 else "DRY")
    for pt in timeline[1:]:
        w = pt["wetness_pct"]
        band = "W" if w >= 68 else ("I" if w >= 28 else "DRY")
        if band != prev_band:
            to_comp = "W" if band == "W" else ("I" if band == "I" else "M")
            reason = (
                f"Heavy storm cell ({pt['mm_hr']} mm/h) — Full Wet Crossover"
                if band == "W"
                else (
                    f"Rain cell hits track ({pt['mm_hr']} mm/h, {w}% wet) — Slick → Inter Crossover"
                    if prev_band == "DRY"
                    else f"Track drying ({live['wind_kph']} km/h {live['wind_dir']} wind) — Inter → Slick Crossover"
                )
            )
            pit_stops.append({
                "lap": pt["lap"],
                "window_lo": max(2, int(round(pt["lap"] - uncertainty_laps))),
                "window_hi": min(total_laps - 1, int(round(pt["lap"] + uncertainty_laps))),
                "to_compound": to_comp,
                "crossover": True,
                "undercut_gain_s": round(1.8 + (intel / 100.0) * 1.4, 2),
                "reason": reason,
            })
            crossover_alerts.append(f"L{pt['lap']}: {reason}")
            prev_band = band

    # If dry race (or no crossovers triggered), compute R&D-adjusted optimal dry undercut/overcut stop(s)
    if not pit_stops:
        if start_wet >= 28:
            mid = max(3, int(round(total_laps * 0.50)))
            pit_stops.append({
                "lap": mid,
                "window_lo": max(2, int(round(mid - uncertainty_laps))),
                "window_hi": min(total_laps - 1, int(round(mid + uncertainty_laps))),
                "to_compound": "W" if start_wet >= 68 else "I",
                "crossover": False,
                "undercut_gain_s": round(1.2 + eff_deg * 10.0, 2),
                "reason": f"Fresh wet rubber refresh (R&D Tyre-Care {t_care:.0f} saves ~{round((1 - rd_tyre_mult)*100)}% wear)",
            })
        else:
            # R&D Tyre Care can turn a tight 2-stop into an optimal 1-stop!
            needs_two = (eff_deg >= 0.076 and total_laps >= 20)
            if needs_two:
                l1 = max(3, int(round(total_laps * 0.30)))
                l2 = max(l1 + 4, int(round(total_laps * 0.64)))
                pit_stops = [
                    {
                        "lap": l1,
                        "window_lo": max(2, int(round(l1 - uncertainty_laps))),
                        "window_hi": min(total_laps - 2, int(round(l1 + uncertainty_laps))),
                        "to_compound": "M",
                        "crossover": False,
                        "undercut_gain_s": round(1.1 + eff_deg * 15.0, 2),
                        "reason": f"Stint 1 Undercut (Deg {eff_deg:.3f}s/lap · Track {live['track_temp_c']}°C)",
                    },
                    {
                        "lap": l2,
                        "window_lo": max(l1 + 2, int(round(l2 - uncertainty_laps))),
                        "window_hi": min(total_laps - 1, int(round(l2 + uncertainty_laps))),
                        "to_compound": "S" if total_laps - l2 <= 9 else "M",
                        "crossover": False,
                        "undercut_gain_s": round(1.0 + eff_deg * 13.0, 2),
                        "reason": "Final Sprint Stint on fresh rubber",
                    },
                ]
            else:
                # Optimal 1-stop pit lap shifted later by high R&D Tyre-Care!
                frac = 0.40 + max(-0.04, min(0.08, (t_care - 78.0) * 0.0035))
                l1 = max(3, min(total_laps - 2, int(round(total_laps * frac))))
                to_c = "H" if start_tyre == "M" else "M"
                pit_stops = [
                    {
                        "lap": l1,
                        "window_lo": max(2, int(round(l1 - uncertainty_laps))),
                        "window_hi": min(total_laps - 1, int(round(l1 + uncertainty_laps))),
                        "to_compound": to_c,
                        "crossover": False,
                        "undercut_gain_s": round(1.0 + eff_deg * 14.5, 2),
                        "reason": f"R&D-Optimized 1-Stop ({start_tyre} → {to_c} · Deg {eff_deg:.3f}s/lap · Pit Loss {pit_loss:.1f}s)",
                    }
                ]

    tier = "NAILED" if intel >= 85 else ("CALIBRATED" if intel >= 62 else "ROUGH ESTIMATE")
    seq = " → ".join([start_tyre] + [p["to_compound"] for p in pit_stops])

    return {
        "ok": True,
        "circuit_id": circuit.get("id"),
        "circuit_name": circuit.get("name"),
        "mode": m,
        "live_weather": live,
        "radar": {
            "cells": cells,
            "wind_kph": live["wind_kph"],
            "wind_deg": live["wind_deg"],
            "wind_dir": live["wind_dir"],
            "peak_mm_hr": round(peak_mm, 2),
            "timeline": timeline,
        },
        "optimal_pit": {
            "intel_pct": intel,
            "tier": tier,
            "uncertainty_laps": uncertainty_laps,
            "tyre_care_rating": round(t_care, 1),
            "effective_deg_s": eff_deg,
            "start_tyre": start_tyre,
            "compound_sequence": seq,
            "pit_stops": pit_stops,
            "crossover_alerts": crossover_alerts,
            "summary": f"{seq} · Pit L{pit_stops[0]['lap']} (±{uncertainty_laps}L) · Undercut +{pit_stops[0]['undercut_gain_s']}s",
        },
    }
