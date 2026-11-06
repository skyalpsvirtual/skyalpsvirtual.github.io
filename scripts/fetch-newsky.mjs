#!/usr/bin/env node
/**
 * Pull SkyAlps Virtual flights from the Newsky airline API and write site/data/stats.json.
 *
 *   NEWSKY_API_KEY=xxxx node scripts/fetch-newsky.mjs            normal run (used by GitHub Actions)
 *   NEWSKY_API_KEY=xxxx node scripts/fetch-newsky.mjs --inspect  print the fields of one real flight (run locally only)
 *
 * Optional environment variables:
 *   NEWSKY_SINCE        first day to backfill on the very first run (default 2026-11-01)
 *   NEWSKY_PILOT_NAMES  "short" (default, "Thomas D.") or "full"
 *   NEWSKY_MOCK_FILE    JSON file with an array of raw flights, used instead of the API (testing)
 *
 * The API key needs the "flights" scope. Keep it secret: GitHub secret or local env var only.
 * Docs: https://newsky.app/apidocs  (rate limit: 5 requests per 10 s)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = resolve(ROOT, "data-cache/flights.json");
const STATS_FILE = resolve(ROOT, "site/data/stats.json");
const API = "https://newsky.app/api/airline-api";
const DAY = 86_400_000;

const KEY = process.env.NEWSKY_API_KEY || "";
const SINCE = process.env.NEWSKY_SINCE || "2026-11-01";
const NAMES = (process.env.NEWSKY_PILOT_NAMES || "short").toLowerCase();
const MOCK = process.env.NEWSKY_MOCK_FILE || "";
const INSPECT = process.argv.includes("--inspect");

/* ---------------- API client (respects 5 req / 10 s) ---------------- */
let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, body) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = lastCall + 2100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(`${API}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-rate-limit-reset") || res.headers.get("retry-after") || 10);
      await sleep(Math.min(Math.max(reset, 2), 30) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Newsky API ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`Newsky API ${path}: still rate-limited after 4 attempts`);
}

/** All flights between two dates (API max span is 30 days, max 100 per page). */
async function flightsBetween(start, end) {
  const out = [];
  for (let skip = 0; ; skip += 100) {
    const page = await api("flights/bydate", {
      start: start.toISOString(), end: end.toISOString(), skip, count: 100, includeDeleted: true,
    });
    const results = page.results || [];
    out.push(...results);
    if (results.length < 100 || out.length >= (page.totalResults ?? 0)) break;
  }
  return out;
}

/* ---------------- Normalisation (defensive: the API returns rich objects) ---------------- */
const isDate = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

function minutesFrom(raw) {
  if (isDate(raw.depTimeAct) && isDate(raw.arrTimeAct)) {
    const m = (Date.parse(raw.arrTimeAct) - Date.parse(raw.depTimeAct)) / 60000;
    if (m > 0 && m < 24 * 60) return Math.round(m);
  }
  const d = raw.durationAct ?? raw.duration;
  if (typeof d !== "number" || d <= 0) return 0;
  if (d < 1440) return Math.round(d); // minutes
  if (d < 86_400) return Math.round(d / 60); // seconds
  return Math.round(d / 60000); // milliseconds
}

function ratingFrom(raw) {
  const r = raw.rating ?? raw.result?.rating;
  if (typeof r === "number") return r;
  if (r && typeof r === "object") {
    for (const k of ["total", "value", "score", "overall"]) if (typeof r[k] === "number") return r[k];
  }
  return null;
}

function displayName(full) {
  if (!full) return "Unknown pilot";
  if (NAMES === "full") return full.trim();
  const [first, ...rest] = full.trim().split(/\s+/);
  const last = rest.pop();
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

const hash = (v) => createHash("sha1").update(String(v)).digest("hex").slice(0, 12);

function normalise(raw) {
  const id = raw._id || raw.id;
  if (!id) return null;
  const date = [raw.close, raw.arrTimeAct, raw.depTimeAct, raw.depTime].find(isDate) || null;
  const airframe = raw.aircraft?.airframe;
  return {
    id: hash(id),
    flightNumber: `${raw.airline?.icao || ""}${raw.flightNumber || ""}` || null,
    dep: raw.dep?.icao || null,
    arr: raw.arr?.icao || null,
    pilotKey: hash(raw.pilot?._id || raw.pilot?.fullname || "unknown"),
    pilot: displayName(raw.pilot?.fullname),
    aircraft: (typeof airframe === "object" ? airframe?.icao || airframe?.ident : airframe) || null,
    date,
    blockMin: minutesFrom(raw),
    rating: ratingFrom(raw),
    pax: Number(raw.result?.totals?.pax ?? raw.payload?.pax ?? 0) || 0,
    network: raw.network || null,
    emergency: Boolean(raw.emergency),
    closed: Boolean(raw.close) || raw.open === false,
    deleted: Boolean(raw.deleted),
  };
}

/* ---------------- Stats ---------------- */
function buildStats(flights) {
  const done = flights.filter((f) => f.closed && !f.deleted).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();
  const last30 = done.filter((f) => (f.date || "") >= since30);
  const rated = done.filter((f) => f.rating != null && !f.emergency);
  const sum = (arr, k) => arr.reduce((s, f) => s + (f[k] || 0), 0);

  const byPilot = new Map();
  for (const f of last30) {
    const p = byPilot.get(f.pilotKey) || { name: f.pilot, flights: 0, blockMinutes: 0 };
    p.flights += 1;
    p.blockMinutes += f.blockMin;
    byPilot.set(f.pilotKey, p);
  }
  const byRoute = new Map();
  for (const f of done) {
    if (!f.dep || !f.arr) continue;
    const key = `${f.dep}-${f.arr}`;
    byRoute.set(key, { dep: f.dep, arr: f.arr, flights: (byRoute.get(key)?.flights || 0) + 1 });
  }

  return {
    status: "ok",
    totals: {
      flights: done.length,
      blockMinutes: sum(done, "blockMin"),
      pilots: new Set(done.map((f) => f.pilotKey)).size,
      pax: sum(done, "pax"),
      avgRating: rated.length ? Math.round((sum(rated, "rating") / rated.length) * 10) / 10 : null,
    },
    last30: { flights: last30.length, blockMinutes: sum(last30, "blockMin") },
    recent: done.slice(0, 10).map(({ flightNumber, dep, arr, pilot, aircraft, blockMin, rating, date }) =>
      ({ flightNumber, dep, arr, pilot, aircraft, blockMin, rating, date })),
    topPilots: [...byPilot.values()].sort((a, b) => b.blockMinutes - a.blockMinutes || b.flights - a.flights).slice(0, 5),
    topRoutes: [...byRoute.values()].sort((a, b) => b.flights - a.flights).slice(0, 5),
  };
}

/* ---------------- Main ---------------- */
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function main() {
  if (!KEY && !MOCK) {
    console.log("NEWSKY_API_KEY is not set: nothing to sync, stats.json left unchanged.");
    return;
  }

  if (INSPECT) {
    const page = await api("flights/recent", { count: 1 });
    const f = page.results?.[0];
    if (!f) return console.log("No flight in the last 7 days to inspect.");
    console.log("Top-level fields:", Object.keys(f).join(", "));
    console.log(JSON.stringify(f, null, 2).slice(0, 6000));
    console.log("\nNormalised:", normalise(f));
    return;
  }

  const cache = await readJson(CACHE_FILE, { backfilledFrom: null, flights: {} });
  const before = JSON.stringify(cache.flights);
  const now = new Date();
  let raw = [];

  if (MOCK) {
    raw = JSON.parse(await readFile(resolve(MOCK), "utf8"));
  } else {
    // First run: backfill from NEWSKY_SINCE. Later runs: re-read the last 30 days (catches edits and deletions).
    let start = cache.backfilledFrom ? new Date(now - 30 * DAY) : new Date(`${SINCE}T00:00:00Z`);
    while (start < now) {
      const end = new Date(Math.min(start.getTime() + 30 * DAY - 1000, now.getTime()));
      raw.push(...(await flightsBetween(start, end)));
      start = new Date(end.getTime() + 1000);
    }
  }

  let added = 0;
  for (const f of raw.map(normalise).filter(Boolean)) {
    if (!cache.flights[f.id]) added++;
    cache.flights[f.id] = f;
  }
  const cacheChanged = JSON.stringify(cache.flights) !== before || !cache.backfilledFrom;
  cache.backfilledFrom ||= MOCK ? null : SINCE;

  const stats = buildStats(Object.values(cache.flights));
  const previous = await readJson(STATS_FILE, {});
  const { generatedAt: _ignored, ...prevBody } = previous;
  const statsChanged = JSON.stringify(prevBody) !== JSON.stringify(stats);

  // Only touch files when something changed, so the hourly job does not commit for nothing.
  if (cacheChanged) {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 1) + "\n");
  }
  if (statsChanged) {
    await writeFile(STATS_FILE, JSON.stringify({ generatedAt: now.toISOString(), ...stats }, null, 2) + "\n");
  }
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `changed=${cacheChanged || statsChanged}\n`, { flag: "a" });
  }
  console.log(`Fetched ${raw.length} flights (${added} new). ${stats.totals.flights} completed in total. stats.json ${statsChanged ? "updated" : "unchanged"}.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
