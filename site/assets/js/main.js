/* SkyAlps Virtual — site behaviour (no build step, no framework). */
(() => {
  "use strict";

  const CFG = window.SKYALPS_CONFIG || {};
  const COLORS = { year: "#12844b", winter: "#1f5fae", summer: "#ee6a1f" };
  const TYPE_LABEL = { year: "All year", winter: "Winter", summer: "Summer" };
  const DAY = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  };

  const fmtBlock = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  const fmtNum = (n) => new Intl.NumberFormat("en-GB").format(n);
  const parseDay = (iso) => new Date(`${iso}T12:00:00`);
  const fmtDate = (iso, withYear) =>
    parseDay(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  const fmtRange = (from, to) => (from === to ? `${fmtDate(from, true)} only` : `${fmtDate(from)} – ${fmtDate(to, true)}`);

  /* ---------- Navigation ---------- */
  const nav = $(".nav");
  const onScroll = () => nav.classList.toggle("is-solid", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const toggle = $(".nav__toggle");
  const links = $("#nav-links");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    links.classList.toggle("is-open", open);
    nav.classList.add("is-solid");
  });
  $$("a", links).forEach((a) =>
    a.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      links.classList.remove("is-open");
    })
  );

  /* ---------- Links from config ---------- */
  const joinUrl = CFG.newskyJoinUrl || "https://newsky.app/pilot/register";
  $$(".js-join-direct").forEach((a) => (a.href = joinUrl));
  if (CFG.discordUrl) $$(".js-discord").forEach((a) => { a.href = CFG.discordUrl; a.hidden = false; });
  if (CFG.contactEmail) $$(".js-contact").forEach((a) => { a.href = `mailto:${CFG.contactEmail}`; a.hidden = false; });

  /* ---------- Live map (Newsky embed) ---------- */
  if (CFG.newskyMapToken) {
    const frame = el("iframe", {
      src: `https://newsky.app/airline/public/map?style=dark&token=${encodeURIComponent(CFG.newskyMapToken)}`,
      title: "SkyAlps Virtual live flights on Newsky",
      loading: "lazy",
    });
    $("#live-map").replaceChildren(frame);
  }

  /* ---------- Route network ---------- */
  fetch("data/routes.json")
    .then((r) => r.json())
    .then(initNetwork)
    .catch((err) => {
      console.error(err);
      $("#route-list").replaceChildren(el("li", { class: "empty", text: "Route data could not be loaded." }));
    });

  function initNetwork(data) {
    const { airports, routes, seasons } = data;
    const today = new Date().toISOString().slice(0, 10);
    const current =
      seasons.find((s) => s.start <= today && today <= s.end) ||
      seasons.find((s) => s.start > today) ||
      seasons[seasons.length - 1];
    const summer = seasons.filter((s) => s.code.startsWith("S")).map((s) => s.code);
    const winter = seasons.filter((s) => s.code.startsWith("W")).map((s) => s.code);
    const runsIn = (r, codes) => codes.some((c) => r.seasons[c] && r.seasons[c].length);

    const FILTERS = {
      current: (r) => runsIn(r, [current.code]),
      all: () => true,
      summer: (r) => runsIn(r, summer),
      winter: (r) => runsIn(r, winter),
      new: (r) => r.tags.includes("new"),
    };

    $$('[data-stat="routes"]').forEach((n) => (n.textContent = routes.length));
    $$('[data-stat="airports"]').forEach((n) => (n.textContent = Object.keys(airports).length));
    const currentChip = $('[data-filter="current"]');
    currentChip.textContent = `This season · ${current.label}`;

    const city = (icao) => airports[icao].city;
    const iata = (icao) => airports[icao].iata;

    /* Map */
    let map = null;
    const arcs = new Map();
    const markers = new Map();
    if (window.L) {
      map = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
      // Esri light grey canvas: free, no API key, no labels (airport tooltips do the labelling).
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
        maxZoom: 10,
      }).addTo(map);
      map.on("click", () => map.scrollWheelZoom.enable());

      for (const r of routes) {
        const line = L.polyline(arcPoints(airports[r.from], airports[r.to]), {
          color: COLORS[r.type], weight: 2.2, opacity: 0.75, lineCap: "round",
        });
        line.on("mouseover", () => hover(r.id, true));
        line.on("mouseout", () => hover(r.id, false));
        line.on("click", (e) => { L.DomEvent.stopPropagation(e); select(r.id, false); });
        arcs.set(r.id, line);
      }

      const bases = new Set(["LIRF", "LQMO"]);
      for (const [icao, a] of Object.entries(airports)) {
        const isHub = icao === "LIPB";
        const marker = L.circleMarker([a.lat, a.lon], {
          radius: isHub ? 9 : bases.has(icao) ? 6.5 : 4.5,
          color: isHub ? "#6ef0c6" : "#ffffff",
          weight: isHub ? 3 : 1.5,
          fillColor: "#0b4d35",
          fillOpacity: 1,
        }).addTo(map);
        marker.bindTooltip(`${a.city}<small>${a.iata}</small>`, {
          className: "apt-tip", direction: "top", offset: [0, -6], permanent: isHub,
        });
        markers.set(icao, marker);
      }
    } else {
      $("#map").replaceChildren(el("p", { class: "placeholder", text: "The map could not be loaded." }));
    }

    /* List */
    const list = $("#route-list");
    const items = new Map();
    for (const r of routes) {
      const badges = [];
      if (r.tags.includes("new")) badges.push(el("span", { class: "badge badge--new", text: "New" }));
      if (r.tags.includes("pso")) badges.push(el("span", { class: "badge badge--pso", text: "PSO" }));
      const btn = el(
        "button",
        {
          class: "route", type: "button", "aria-pressed": "false",
          onclick: () => select(r.id, true),
          onmouseenter: () => hover(r.id, true),
          onmouseleave: () => hover(r.id, false),
        },
        el("span", { class: "route__bar", style: `background:${COLORS[r.type]}` }),
        el("span", {},
          el("span", { class: "route__name" }, `${city(r.from)} – ${city(r.to)}`, ...badges),
          el("span", { class: "route__meta", text: `${iata(r.from)}–${iata(r.to)} · ${TYPE_LABEL[r.type]}` })
        ),
        el("span", { class: "route__side" }, `${r.distanceNm} nm`, el("br"), fmtBlock(r.blockMin))
      );
      const li = el("li", {}, btn);
      items.set(r.id, { li, btn });
      list.append(li);
    }

    let filter = "current";
    let selected = null;

    function applyFilter() {
      const visible = routes.filter(FILTERS[filter]);
      const ids = new Set(visible.map((r) => r.id));
      for (const r of routes) {
        items.get(r.id).li.hidden = !ids.has(r.id);
        if (map) {
          const line = arcs.get(r.id);
          if (ids.has(r.id)) line.addTo(map);
          else line.remove();
        }
      }
      $("#route-count").textContent = visible.length;
      if (map) {
        const served = new Set(visible.flatMap((r) => [r.from, r.to]));
        for (const [icao, marker] of markers) {
          if (served.has(icao) || icao === "LIPB") marker.addTo(map);
          else marker.remove();
        }
        const pts = visible.flatMap((r) => [airports[r.from], airports[r.to]]).map((a) => [a.lat, a.lon]);
        if (pts.length) map.fitBounds(pts, { padding: [36, 36], maxZoom: 6 });
      }
      if (selected && !ids.has(selected)) clearSelection();
    }

    $$(".chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        $$(".chip").forEach((c) => c.classList.toggle("is-active", c === chip));
        filter = chip.dataset.filter;
        applyFilter();
      })
    );

    function hover(id, on) {
      items.get(id).btn.classList.toggle("is-hover", on);
      if (!map) return;
      const line = arcs.get(id);
      if (id === selected) return;
      line.setStyle(on ? { weight: 4, opacity: 1 } : { weight: 2.2, opacity: 0.75 });
      if (on) line.bringToFront();
    }

    function clearSelection() {
      if (selected) {
        items.get(selected).btn.classList.remove("is-selected");
        items.get(selected).btn.setAttribute("aria-pressed", "false");
        if (map) {
          arcs.get(selected).setStyle({ weight: 2.2, opacity: 0.75 });
          const old = routes.find((x) => x.id === selected);
          for (const icao of [old.from, old.to]) if (icao !== "LIPB") markers.get(icao).closeTooltip();
        }
      }
      selected = null;
      $("#route-detail").hidden = true;
    }

    function select(id, fromList) {
      clearSelection();
      selected = id;
      const r = routes.find((x) => x.id === id);
      const { btn } = items.get(id);
      btn.classList.add("is-selected");
      btn.setAttribute("aria-pressed", "true");
      if (map) {
        const line = arcs.get(id);
        line.setStyle({ weight: 4.5, opacity: 1 }).bringToFront();
        if (fromList) map.flyToBounds(line.getBounds(), { padding: [70, 70], maxZoom: 6, duration: 0.6 });
        if (r.from !== "LIPB") markers.get(r.from).openTooltip();
        markers.get(r.to).openTooltip();
      }
      if (!fromList) {
        // Bring the list entry into view without scrolling the whole page.
        const box = $("#route-list");
        box.scrollTop = btn.parentElement.offsetTop - box.offsetTop - box.clientHeight / 2;
      }
      renderDetail(r);
    }

    function renderDetail(r) {
      const from = airports[r.from];
      const to = airports[r.to];
      $("#rd-codes").textContent = `${from.iata} ⇄ ${to.iata} · ${r.from} ⇄ ${r.to}`;
      $("#rd-title").textContent = `${from.city} ⇄ ${to.city}`;
      $("#rd-dist").textContent = `${r.distanceNm} nm`;
      $("#rd-block").textContent = fmtBlock(r.blockMin);
      $("#rd-flights").textContent = r.flights.length ? r.flights.join(" / ") : "PSO service";
      $("#rd-out-head").textContent = `${from.iata} → ${to.iata}`;
      $("#rd-back-head").textContent = `${to.iata} → ${from.iata}`;

      const available = seasons.filter((s) => r.seasons[s.code] && r.seasons[s.code].length);
      let active = available.find((s) => s.code === current.code) || available[0];
      const tabs = $("#rd-tabs");
      const drawTabs = () =>
        tabs.replaceChildren(
          ...available.map((s) =>
            el("button", {
              class: "tab", role: "tab", type: "button", "aria-selected": String(s === active), text: s.label,
              onclick: () => { active = s; drawTabs(); drawRows(); },
            })
          )
        );
      const drawRows = () =>
        $("#rd-rows").replaceChildren(
          ...r.seasons[active.code].map((row) =>
            el("tr", {},
              el("td", { text: DAY[row.day] }),
              el("td", { class: "mono", text: `${row.out[0]} → ${row.out[1]}` }),
              el("td", { class: "mono", text: row.out[2] || "–" }),
              el("td", { class: "mono", text: `${row.back[0]} → ${row.back[1]}` }),
              el("td", { class: "mono", text: row.back[2] || "–" }),
              el("td", { text: fmtRange(row.from, row.to) })
            )
          )
        );
      drawTabs();
      drawRows();
      $("#route-detail").hidden = false;
    }

    applyFilter();
  }

  /* Curved great-circle-ish arc between two airports (quadratic Bézier in lat/lon space). */
  function arcPoints(a, b, steps = 40) {
    const dx = b.lon - a.lon;
    const dy = b.lat - a.lat;
    const bend = 0.16;
    const cx = (a.lon + b.lon) / 2 - dy * bend;
    const cy = (a.lat + b.lat) / 2 + dx * bend;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      pts.push([u * u * a.lat + 2 * u * t * cy + t * t * b.lat, u * u * a.lon + 2 * u * t * cx + t * t * b.lon]);
    }
    return pts;
  }

  /* ---------- Live stats (written hourly by the Newsky sync job) ---------- */
  fetch("data/stats.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then(renderStats)
    .catch((err) => console.warn("stats.json unavailable", err));

  function ratingClass(v) {
    const score = v > 10 ? v / 10 : v;
    return score >= 8 ? "rating--good" : score >= 6 ? "rating--mid" : "rating--low";
  }
  const fmtRating = (v) => (v == null ? "–" : v > 10 ? Math.round(v) : v.toFixed(1));

  function renderStats(s) {
    if (!s || !s.totals) return;
    const t = s.totals;
    $("#st-flights").textContent = fmtNum(t.flights || 0);
    // One decimal under 10 h, so a single 1h32 flight reads "1.5" instead of "2".
    const hours = (t.blockMinutes || 0) / 60;
    $("#st-hours").textContent = hours < 10 ? String(Math.round(hours * 10) / 10) : fmtNum(Math.round(hours));
    $("#st-pilots").textContent = fmtNum(t.pilots || 0);
    $("#st-rating").textContent = fmtRating(t.avgRating);
    if (s.generatedAt) {
      const d = new Date(s.generatedAt);
      $("#st-updated").textContent = `Updated ${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
    }

    if (s.recent && s.recent.length) {
      $("#pirep-empty").hidden = true;
      $("#pirep-rows").replaceChildren(
        ...s.recent.map((f) =>
          el("tr", {},
            el("td", { class: "mono", text: f.flightNumber || "–" }),
            el("td", { text: `${f.dep || "?"} → ${f.arr || "?"}` }),
            el("td", { text: f.pilot || "–" }),
            el("td", { class: "mono", text: f.blockMin ? fmtBlock(f.blockMin) : "–" }),
            el("td", {}, f.rating == null ? "–" : el("span", { class: `rating ${ratingClass(f.rating)}`, text: fmtRating(f.rating) })),
            el("td", { text: f.date ? fmtDate(f.date.slice(0, 10)) : "–" })
          )
        )
      );
    }

    if (s.topPilots && s.topPilots.length) {
      $("#leaders-empty").hidden = true;
      $("#leaders").replaceChildren(
        ...s.topPilots.map((p) =>
          el("li", {},
            el("strong", { text: p.name }),
            el("span", { text: `${p.flights} flt · ${fmtBlock(p.blockMinutes)}` })
          )
        )
      );
    }
  }
})();
