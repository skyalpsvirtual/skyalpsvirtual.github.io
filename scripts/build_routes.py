"""Turn data-src/timetable-*.txt + data-src/airports.json into site/data/routes.json.

Usage:  python scripts/build_routes.py [path/to/timetable.txt]
"""
import json
import math
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TIMETABLE = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data-src" / "timetable-2026-27.txt"
AIRPORTS = ROOT / "data-src" / "airports.json"
OUT = ROOT / "site" / "data" / "routes.json"

DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def d(text: str) -> str:
    return datetime.strptime(text, "%d.%m.%Y").date().isoformat()


def minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def great_circle_nm(a: dict, b: dict) -> int:
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return round(2 * 3440.065 * math.asin(math.sqrt(h)))


def main() -> None:
    airports = {k: v for k, v in json.loads(AIRPORTS.read_text(encoding="utf-8")).items() if not k.startswith("_")}
    seasons, routes = [], {}
    season = route = None

    for lineno, raw in enumerate(TIMETABLE.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if parts[0] == "@SEASON":
            code, label, start, end = parts[1:5]
            season = {"code": code, "label": label.replace("-", " "), "start": d(start), "end": d(end)}
            seasons.append(season)
            continue
        if parts[0] == "ROUTE":
            origin, dest, *tags = parts[1:]
            for icao in (origin, dest):
                if icao not in airports:
                    sys.exit(f"line {lineno}: unknown airport {icao}, add it to {AIRPORTS.name}")
            key = f"{origin}-{dest}"
            route = routes.setdefault(key, {
                "id": key, "from": origin, "to": dest, "tags": [], "flights": [], "seasons": {},
                "distanceNm": great_circle_nm(airports[origin], airports[dest]),
            })
            for t in tags:
                if t not in route["tags"]:
                    route["tags"].append(t)
            route["seasons"].setdefault(season["code"], [])
            continue
        if parts[0] in DAYS:
            if route is None or season is None:
                sys.exit(f"line {lineno}: schedule row before any ROUTE/@SEASON")
            day, o_dep, o_arr, o_flt, b_dep, b_arr, b_flt, v_from, v_to = parts
            v_from, v_to = sorted((d(v_from), d(v_to)))
            route["seasons"][season["code"]].append({
                "day": day, "out": [o_dep, o_arr, None if o_flt == "-" else o_flt],
                "back": [b_dep, b_arr, None if b_flt == "-" else b_flt], "from": v_from, "to": v_to,
            })
            for f in (o_flt, b_flt):
                if f != "-" and f not in route["flights"]:
                    route["flights"].append(f)
            continue
        sys.exit(f"line {lineno}: cannot parse '{line}'")

    season_codes = [s["code"] for s in seasons]
    for r in routes.values():
        present = [c for c in season_codes if r["seasons"].get(c)]
        if "pso" in r["tags"] and len(present) == 1 and present[0].startswith("S"):
            r["type"] = "summer"
        elif len(present) == len(season_codes):
            r["type"] = "year"
        else:
            r["type"] = "summer" if present[0].startswith("S") else "winter"
        # Block time: averaging the out and back legs cancels any time-zone difference.
        first = r["seasons"][present[-1]][0]
        legs = [(minutes(first["out"][1]) - minutes(first["out"][0])) % 1440,
                (minutes(first["back"][1]) - minutes(first["back"][0])) % 1440]
        r["blockMin"] = round(sum(legs) / 2 / 5) * 5
        for c in present:
            r["seasons"][c].sort(key=lambda row: (DAYS.index(row["day"]), row["from"]))

    used = {icao for r in routes.values() for icao in (r["from"], r["to"])}
    out = {
        "generated": date.today().isoformat(),
        "source": "SkyAlps official timetable 2026/27 (published 15.09.2026)",
        "seasons": seasons,
        "airports": {k: v for k, v in airports.items() if k in used},
        "routes": sorted(routes.values(), key=lambda r: (r["from"] != "LIPB", r["from"], airports[r["to"]]["city"])),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    by_type = {t: sum(1 for r in routes.values() if r["type"] == t) for t in ("year", "summer", "winter")}
    print(f"{len(routes)} routes, {len(used)} airports -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    print("by type:", by_type)
    for r in out["routes"]:
        print(f"  {r['id']:10} {r['type']:6} {r['distanceNm']:>4} nm  {r['blockMin'] // 60}h{r['blockMin'] % 60:02d}  "
              f"{','.join(r['flights']) or '-':24} {' '.join(r['tags'])}")


if __name__ == "__main__":
    main()
