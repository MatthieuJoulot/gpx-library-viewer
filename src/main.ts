/// <reference types="vite/client" />
import * as maplibregl from "maplibre-gl";
// MapLibre v6 is ESM-only and needs an explicit worker URL under bundlers (Vite),
// otherwise the web worker never spawns: no tiles, no GeoJSON rendering.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
maplibregl.setWorkerUrl(workerUrl);
import type { TrackMeta } from "./gpx";
import { groupByCollection, matchesQuery, collectionColorMap, collectionLabel } from "./collections";
import { fmtDistance, fmtGain, fmtDuration } from "./format";
import { addDirectory, rescan, hasFsAccessApi, tracksFromFileList, readLibraryFile } from "./fsaccess";
import { parseSheets, buildJoin } from "./metadata";
import type { SheetMeta } from "./metadata";

// ---------- basemap catalog (all keyless, verified reachable) ----------
interface Basemap {
  id: string;
  label: string;
  urls: string[];
  tileSize: number;
  attribution: string;
  maxZoom?: number;
}

const BASEMAPS: Basemap[] = [
  {
    id: "osm",
    label: "Streets (OSM)",
    urls: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution: "© OpenStreetMap contributors",
  },
  {
    id: "cycle",
    label: "Cycling (CyclOSM)",
    urls: ["https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", "https://b.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", "https://c.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"],
    tileSize: 256,
    attribution: "© OpenStreetMap contributors | CyclOSM",
    maxZoom: 18,
  },
  {
    id: "satellite",
    label: "Satellite (Esri)",
    urls: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    attribution: "Esri, Maxar, Earthstar Geographics",
    maxZoom: 18,
  },
];

function styleFor(b: Basemap): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: b.urls,
        tileSize: b.tileSize,
        attribution: b.attribution,
        maxzoom: b.maxZoom ?? 19,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  } as maplibregl.StyleSpecification;
}

// ---------- dom ----------
const tree = document.getElementById("tree")!;
const empty = document.getElementById("empty")!;
const pickBtn = document.getElementById("pick-btn")!;
const rescanBtn = document.getElementById("rescan-btn") as HTMLButtonElement;
const addLibBtn = document.getElementById("add-lib-btn") as HTMLButtonElement;
const footer = document.getElementById("footer")!;
const trackCount = document.getElementById("track-count")!;
const search = document.getElementById("search") as HTMLInputElement;
const legacyInput = document.getElementById("legacy-dir-input") as HTMLInputElement;
const filtersBox = document.getElementById("coll-filter-box")!;
const collFilters = document.getElementById("coll-filters")!;
const rangeFiltersBox = document.getElementById("range-filter-box")!;
const distMin = document.getElementById("dist-min") as HTMLInputElement;
const distMax = document.getElementById("dist-max") as HTMLInputElement;
const eleMin = document.getElementById("ele-min") as HTMLInputElement;
const eleMax = document.getElementById("ele-max") as HTMLInputElement;
const filtersResetBtn = document.getElementById("filters-reset-btn") as HTMLButtonElement;

// ---------- state ----------
let allTracks: TrackMeta[] = [];
let selectedId: string | null = null;
let collColors = new Map<string, string>();
let enabledCollections = new Set<string>(); // empty = all enabled
let distMinKm = 0;
let distMaxKm = Infinity;
let eleMinM: number | null = null; // null = no lower bound (tracks without ele data pass)
let eleMaxM: number | null = null;

let sheetJoin = new Map<string, SheetMeta>();

// ---------- map ----------
const map = new maplibregl.Map({
  container: "map",
  style: styleFor(BASEMAPS[0]),
  center: [2.3, 46.5],
  zoom: 5,
});
map.addControl(new maplibregl.NavigationControl());

// basemap switcher control (top-left)
const basemapControl = {
  onAdd(): HTMLElement {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const sel = document.createElement("select");
    sel.title = "Basemap";
    sel.style.cssText = "border:none;font-size:12px;padding:4px;background:var(--bg, #fff);";
    for (const b of BASEMAPS) {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.label;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      const b = BASEMAPS.find((x) => x.id === sel.value);
      if (!b) return;
      map.setStyle(styleFor(b));
      mapReady = false;
      map.once("style.load", () => {
        mapReady = true;
        setupMapLayers();
        pendingData = false;
        refreshAll();
      });
    };
    div.appendChild(sel);
    return div;
  },
  onRemove(): void {
    this.container?.remove();
  },
  container: undefined as HTMLElement | undefined,
};
map.addControl(basemapControl as unknown as maplibregl.IControl, "top-left");

// "fit all tracks" button on the map
const resetControl = {
  onAdd(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "maplibregl-ctrl maplibregl-ctrl-group reset-view-btn";
    btn.type = "button";
    btn.title = "Show all tracks";
    btn.textContent = "⤢";
    btn.style.cssText = "font-size:18px;width:29px;height:29px;display:flex;align-items:center;justify-content:center;";
    btn.onclick = () => fitAllTracks();
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.container.appendChild(btn);
    return this.container;
  },
  onRemove(): void {
    this.container?.remove();
  },
  container: undefined as HTMLElement | undefined,
};
map.addControl(resetControl as unknown as maplibregl.IControl);

function fitAllTracks() {
  const tracks = visibleTracks();
  if (!tracks.length) return;
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const t of tracks) {
    if (t.bounds[0] < minLon) minLon = t.bounds[0];
    if (t.bounds[1] < minLat) minLat = t.bounds[1];
    if (t.bounds[2] > maxLon) maxLon = t.bounds[2];
    if (t.bounds[3] > maxLat) maxLat = t.bounds[3];
  }
  map.fitBounds(
    [
      [minLon, minLat],
      [maxLon, maxLat],
    ],
    { padding: 80, duration: 700 },
  );
}

// ---------- map setup: idempotent, callable before OR after style load ----------
let mapReady = false;
let pendingData = false;

function setupMapLayers() {
  if (map.getSource("tracks") || map.getSource("sel")) return; // already done
  map.addSource("tracks", { type: "geojson", data: emptyFc() });
  map.addSource("sel", { type: "geojson", data: emptyFc() });

  // all tracks, colored by collection
  map.addLayer({
    id: "tracks-casing",
    type: "line",
    source: "tracks",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.85 },
  });
  map.addLayer({
    id: "tracks-line",
    type: "line",
    source: "tracks",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#999999"],
      "line-width": 4,
      "line-opacity": 0.9,
    },
  });
  // selected track drawn on top: white casing + thick colored line
  map.addLayer({
    id: "sel-casing",
    type: "line",
    source: "sel",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 13, "line-opacity": 0.95 },
  });
  map.addLayer({
    id: "sel-line",
    type: "line",
    source: "sel",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["coalesce", ["get", "color"], "#2563eb"], "line-width": 6.5 },
  });

  // cursor + hover dimming
  for (const layerId of ["tracks-line", "sel-line"]) {
    map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
  }

  // click any path → select the corresponding track (opens + scrolls list)
  map.on("click", "tracks-line", (e) => {
    const f = e.features?.[0];
    const id = f?.properties?.id as string | undefined;
    if (id) select(id, { fitMap: false });
  });
  map.on("click", "sel-line", (e) => {
    const f = e.features?.[0];
    const id = f?.properties?.id as string | undefined;
    if (id) select(id, { fitMap: true });
  });
}

function onMapReady(): Promise<void> {
  if (mapReady) return Promise.resolve();
  return new Promise((resolve) =>
    map.once("load", () => {
      setupMapLayers();
      mapReady = true;
      resolve();
    }),
  );
}

// kick off immediately; if style already loaded the promise resolves fast
void onMapReady();

async function flushPendingData() {
  if (!pendingData) return;
  pendingData = false;
  refreshAll();
}

function emptyFc(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

// ---------- filtering ----------
function visibleTracks(): TrackMeta[] {
  return allTracks.filter((t) => {
    if (enabledCollections.size && !enabledCollections.has(t.collection)) return false;
    if (t.stats.distanceKm < distMinKm) return false;
    if (t.stats.distanceKm > distMaxKm) return false;
    const gain = t.stats.elevationGainM;
    if (eleMinM != null && (gain == null || gain < eleMinM)) return false;
    if (eleMaxM != null && gain != null && gain > eleMaxM) return false;
    if (!matchesQuery(t, search.value.trim())) return false;
    return true;
  });
}

function refreshAll() {
  renderTree();
  const tracksSource = map.getSource("tracks") as maplibregl.GeoJSONSource | undefined;
  if (tracksSource) {
    tracksSource.setData({ type: "FeatureCollection", features: visibleTracks().map(trackFeature) });
  }
  // drop selection if it got filtered out
  if (selectedId && !visibleTracks().some((t) => t.id === selectedId)) {
    selectedId = null;
    const selSource = map.getSource("sel") as maplibregl.GeoJSONSource | undefined;
    if (selSource) selSource.setData(emptyFc());
  }
  trackCount.textContent = `${visibleTracks().length}/${allTracks.length} tracks`;
}

function renderCollFilters() {
  collFilters.textContent = "";
  const colls = groupByCollection(allTracks);
  for (const c of colls) {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !enabledCollections.size || enabledCollections.has(c.key);
    cb.onchange = () => {
      if (!enabledCollections.size && !cb.checked) {
        // first uncheck from "all" state → seed with everything, then remove
        enabledCollections = new Set(colls.map((x) => x.key));
      }
      if (cb.checked) {
        enabledCollections.add(c.key);
        if (enabledCollections.size === colls.length) enabledCollections.clear(); // all on = all
      } else {
        enabledCollections.delete(c.key);
      }
      refreshAll();
      renderCollFilters();
    };
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = c.color;
    label.append(cb, swatch, document.createTextNode(collectionLabel(c)));
    collFilters.appendChild(label);
  }
}

/** Typed number-field pair: empty = no bound. min/max enforced loosely on blur. */
function bindNumPair(
  minEl: HTMLInputElement,
  maxEl: HTMLInputElement,
  onChange: (min: number | null, max: number | null) => void,
) {
  const read = () => {
    const lo = minEl.value.trim() === "" ? null : Number(minEl.value);
    const hi = maxEl.value.trim() === "" ? null : Number(maxEl.value);
    const loOk = lo != null && isFinite(lo) ? lo : null;
    const hiOk = hi != null && isFinite(hi) ? hi : null;
    if (loOk != null && hiOk != null && loOk > hiOk) {
      // crossed: mirror the field the user is not typing in
      if (document.activeElement === minEl) maxEl.value = String(loOk);
      else minEl.value = String(hiOk);
      onChange(loOk, document.activeElement === minEl ? loOk : hiOk);
      return;
    }
    onChange(loOk, hiOk);
  };
  // live filtering while typing; commit on Enter/blur for cleanliness
  minEl.addEventListener("input", read);
  maxEl.addEventListener("input", read);
  for (const el of [minEl, maxEl]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") el.blur();
    });
  }
}

bindNumPair(distMin, distMax, (lo, hi) => {
  distMinKm = lo ?? 0;
  distMaxKm = hi ?? Infinity;
  refreshAll();
});

bindNumPair(eleMin, eleMax, (lo, hi) => {
  eleMinM = lo;
  eleMaxM = hi;
  refreshAll();
});

/** Reset every filter: collections, typed ranges, search. */
filtersResetBtn.onclick = () => {
  enabledCollections.clear();
  distMin.value = "";
  distMax.value = "";
  distMinKm = 0;
  distMaxKm = Infinity;
  eleMin.value = "";
  eleMax.value = "";
  eleMinM = null;
  eleMaxM = null;
  search.value = "";
  renderCollFilters();
  refreshAll();
};

// ---------- geojson helpers ----------
function trackFeature(t: TrackMeta): GeoJSON.Feature {
  return {
    ...t.geojson.features[0],
    properties: {
      ...(t.geojson.features[0].properties ?? {}),
      id: t.id,
      color: collColors.get(t.collection) ?? "#999999",
    },
  };
}

function selFeature(t: TrackMeta | null): GeoJSON.FeatureCollection {
  return t ? { type: "FeatureCollection", features: [trackFeature(t)] } : emptyFc();
}

function bboxOf(t: TrackMeta): [[number, number], [number, number]] {
  const [minLon, minLat, maxLon, maxLat] = t.bounds;
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

// ---------- sidebar ----------
function renderTree() {
  tree.textContent = "";
  const collections = groupByCollection(visibleTracks(), collColors);

  for (const coll of collections) {
    const box = document.createElement("div");
    box.className = "collection";

    const head = document.createElement("div");
    head.className = "coll-head";
    head.innerHTML =
      `<span class="chev">▶</span>` +
      `<span class="swatch" style="background:${coll.color}"></span>` +
      `<span class="label">${escapeHtml(collectionLabel(coll))}</span>` +
      `<span class="count">${coll.tracks.length}</span>`;
    head.onclick = () => box.classList.toggle("open");
    box.appendChild(head);
    if (selectedId && coll.tracks.some((t) => t.id === selectedId)) box.classList.add("open");

    const files = document.createElement("div");
    files.className = "files";
    for (const t of coll.tracks) files.appendChild(renderItem(t, coll.color));
    box.appendChild(files);
    tree.appendChild(box);
  }
}

function renderItem(t: TrackMeta, collColor: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "item" + (t.id === selectedId ? " selected" : "");
  item.dataset.id = t.id;

  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML =
    `<span class="swatch" style="background:${collColor}"></span>` +
    `<span class="name">${escapeHtml(t.name)}</span>`;
  item.appendChild(row);

  const details = document.createElement("div");
  details.className = "details";
  details.innerHTML = detailsHtml(t);
  item.appendChild(details);

  item.onclick = () => select(t.id, { fitMap: true, fromList: true });
  return item;
}

function detailsHtml(t: TrackMeta): string {
  const rows: string[] = [];
  rows.push(`<tr><td class="k">Distance</td><td>${fmtDistance(t.stats.distanceKm)}</td></tr>`);
  rows.push(`<tr><td class="k">Elevation</td><td>${fmtGain(t.stats.elevationGainM)}</td></tr>`);
  rows.push(`<tr><td class="k">Duration</td><td>${fmtDuration(t.stats.durationS)}</td></tr>`);
  rows.push(`<tr><td class="k">File</td><td>${escapeHtml(t.fileName)}</td></tr>`);
  let profileHtml = "";
  if (t.profile) {
    profileHtml =
      `<div class="profile-axes"><span>${t.profile.minEle} m</span><span>${t.profile.maxEle} m</span></div>` +
      sparklineSvg(t.profile);
  }
  const sheet = sheetJoin.get(t.id);
  let linksHtml = "";
  if (sheet) {
    const links: string[] = [];
    links.push(`<a href="${escapeHtml(sheet.url)}" target="_blank" rel="noopener">Route sheet ↗</a>`);
    if (sheet.komoot) links.push(`<a href="${escapeHtml(sheet.komoot)}" target="_blank" rel="noopener">Komoot ↗</a>`);
    linksHtml = `<div class="sheet-links">${links.join("")}</div>`;
  }
  return `<table>${rows.join("")}</table>${profileHtml}${linksHtml}`;
}

/** Compact elevation profile as inline SVG. */
function sparklineSvg(profile: { points: [number, number][]; minEle: number; maxEle: number }): string {
  const W = 300;
  const H = 56;
  const PAD = 2;
  const { points, minEle, maxEle } = profile;
  const totalKm = points[points.length - 1][0] || 1;
  const span = Math.max(1, maxEle - minEle);
  const step = Math.max(1, Math.ceil(points.length / 400)); // downsample to ≤400 pts
  const pathParts: string[] = [];
  for (let i = 0; i < points.length; i += step) {
    const [km, ele] = points[i];
    const x = PAD + (km / totalKm) * (W - 2 * PAD);
    const y = H - PAD - ((ele - minEle) / span) * (H - 2 * PAD);
    pathParts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }
  // close the area back to baseline for a filled look
  const area = `${pathParts.join(" ")} L${(W - PAD).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;
  return (
    `<svg class="profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
    `<path d="${area}" fill="rgba(37,99,235,0.12)"/>` +
    `<path d="${pathParts.join(" ")}" fill="none" stroke="#2563eb" stroke-width="1.5"/>` +
    `</svg>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---------- selection ----------
function select(id: string | null, opts: { fitMap: boolean; fromList?: boolean }) {
  selectedId = id;
  const sel = allTracks.find((t) => t.id === id) ?? null;

  const tracksSource = map.getSource("tracks") as maplibregl.GeoJSONSource | undefined;
  if (tracksSource) {
    tracksSource.setData({ type: "FeatureCollection", features: visibleTracks().map(trackFeature) });
  }
  const selSource = map.getSource("sel") as maplibregl.GeoJSONSource | undefined;
  if (selSource) selSource.setData(selFeature(sel));

  // map not loaded yet? flag data and flush when style finishes loading
  if (!tracksSource) {
    pendingData = true;
    void onMapReady().then(flushPendingData);
  }

  renderTree();

  // scroll list to the selected item (even if inside a collapsed collection)
  if (sel) {
    const el = tree.querySelector<HTMLElement>(`.item[data-id="${cssEscape(id!)}"]`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  if (sel && opts.fitMap) map.fitBounds(bboxOf(sel), { padding: 80, maxZoom: 14, duration: 700 });
}

function cssEscape(s: string): string {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// ---------- events ----------
// Two modes:
//  - Chromium: File System Access API (persistent handles, rescan possible)
//  - Safari/Firefox: legacy webkitdirectory upload (one-shot snapshot, no rescan)
let legacyMode = !hasFsAccessApi();
console.log("[gpx-library] file access:", legacyMode ? "legacy upload (Safari/Firefox)" : "File System Access API (Chromium)");
if (legacyMode) {
  // No persistent handles in this browser → Rescan impossible. Show why, don't hide.
  rescanBtn.disabled = true;
  rescanBtn.title = "Rescan needs Chrome/Edge (File System Access API). This browser only supports one-shot folder upload.";
  rescanBtn.style.opacity = "0.5";
  rescanBtn.style.cursor = "not-allowed";
}

/** "replace" = first load, "add" = merge with current library. */
let legacyAction: "replace" | "add" = "replace";

pickBtn.onclick = async () => {
  if (legacyMode) {
    legacyAction = "replace";
    legacyInput.click();
    return;
  }
  try {
    const tracks = await addDirectory();
    if (tracks) loadTracks(tracks);
  } catch {
    /* user cancelled picker */
  }
};

legacyInput.onchange = async () => {
  if (!legacyInput.files?.length) return;
  const incoming = await tracksFromFileList(legacyInput.files);
  if (legacyAction === "add" && allTracks.length) {
    // merge: dedupe by id so re-adding the same folder doesn't double tracks
    const byId = new Map(allTracks.map((t) => [t.id, t]));
    for (const t of incoming) byId.set(t.id, t); // same id = replaces
    loadTracks([...byId.values()], { keepView: true });
  } else {
    loadTracks(incoming);
  }
  legacyInput.value = ""; // allow re-picking the same folder later
};

addLibBtn.onclick = async () => {
  if (legacyMode) {
    legacyAction = "add";
    legacyInput.click();
    return;
  }
  addLibBtn.disabled = true;
  try {
    const tracks = await addDirectory();
    loadTracks(tracks);
  } catch (err) {
    // surface real errors (AbortError = user cancelled picker)
    if ((err as DOMException)?.name !== "AbortError") {
      console.error("add folder failed:", err);
      alert(`Could not add folder: ${(err as Error).message}`);
    }
  } finally {
    addLibBtn.disabled = false;
  }
};

rescanBtn.onclick = async () => {
  if (legacyMode || !allTracks.length) return;
  rescanBtn.disabled = true;
  try {
    loadTracks(await rescan(), { keepView: true });
  } catch (err) {
    console.error("rescan failed:", err);
    alert(`Rescan failed: ${(err as Error).message}`);
  } finally {
    rescanBtn.disabled = false;
  }
};

search.oninput = () => refreshAll();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") select(null, { fitMap: false });
});

// ---------- boot ----------
function loadTracks(tracks: TrackMeta[], opts: { keepView?: boolean } = {}) {
  const previousSelection = opts.keepView ? selectedId : null;
  allTracks = tracks;
  selectedId = null;
  collColors = collectionColorMap(tracks);
  enabledCollections.clear();

  // metadata join: prefer the Recto Verso sheet title as display name
  applySheetNames(tracks);

  // clear typed range filters (empty = unbounded)
  distMin.value = "";
  distMax.value = "";
  distMinKm = 0;
  distMaxKm = Infinity;
  eleMin.value = "";
  eleMax.value = "";
  eleMinM = null;
  eleMaxM = null;

  empty.style.display = "none";
  tree.style.display = "";
  footer.style.display = "";
  filtersBox.style.display = "";
  rangeFiltersBox.style.display = "";
  renderCollFilters();
  refreshAll();

  // map not loaded yet? flag and flush on load
  const tracksSource = map.getSource("tracks") as maplibregl.GeoJSONSource | undefined;
  if (!tracksSource) {
    pendingData = true;
    void onMapReady().then(flushPendingData);
  }

  fitAllTracks();
  if (previousSelection) {
    // reselect same track after rescan (id may have changed if files moved)
    const same = allTracks.find((t) => t.id === previousSelection);
    if (same) select(same.id, { fitMap: false });
  }
}

// ---------- metadata (Recto Verso sheets.json) ----------
function applySheetNames(tracks: TrackMeta[]) {
  // Read sheets.json from the picked library folder (Chromium) or /sheets.json
  // (dev server root, legacy mode). Missing file = no links, app still works.
  void loadSheets().then((sheets) => {
    sheetJoin = buildJoin(tracks, sheets);
    console.log(`[gpx-library] metadata: ${sheetJoin.size}/${tracks.length} tracks joined to route sheets`);
    // prefer the sheet title as display name
    for (const t of tracks) {
      const s = sheetJoin.get(t.id);
      if (s) t.name = s.name;
    }
    refreshAll();
  });
}

async function loadSheets(): Promise<SheetMeta[]> {
  // 1) try the picked library directory itself (fs access mode)
  if (hasFsAccessApi()) {
    try {
      const text = await readLibraryFile("sheets.json");
      if (text) return parseSheets(JSON.parse(text));
    } catch {
      /* fall through */
    }
  }
  // 2) dev-server fallback: project root copy
  try {
    const res = await fetch("/sheets.json");
    if (res.ok) return parseSheets(await res.json());
  } catch {
    /* ignore */
  }
  console.warn("[gpx-library] sheets.json not found — route-sheet links disabled. Place it in the picked GPX folder root.");
  return [];
}
