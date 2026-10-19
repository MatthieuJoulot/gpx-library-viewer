import { gpx as gpxToGeoJson } from "@tmcw/togeojson";
export interface TrackStats {
  distanceKm: number;
  elevationGainM: number | null; // null when no <ele> data
  durationS: number | null; // null when no <time> data
}

/** Elevation profile sample: [cumulativeDistanceKm, elevationM]. */
export type ElePoint = [number, number];

export interface EleProfile {
  points: ElePoint[];
  minEle: number;
  maxEle: number;
}

export interface TrackMeta {
  id: string; // unique: "collection/fileName"
  collection: string; // "lib" or "lib/::/subfolder"
  fileName: string; // "Le versant oublié du Cantal.gpx"
  name: string; // display name (gpx <name> or filename without ext)
  bounds: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  geojson: GeoJSON.FeatureCollection;
  stats: TrackStats;
  profile: EleProfile | null; // null when no elevation data
}


/** Parse GPX text into geometry + stats. Throws on invalid XML. */
export function parseGpx(
  text: string,
  fallbackName: string,
): Omit<TrackMeta, "id" | "collection" | "fileName" | "color"> {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("invalid XML");

  const fc = gpxToGeoJson(doc) as unknown as GeoJSON.FeatureCollection;

  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const f of fc.features) {
    const g = f.geometry as GeoJSON.LineString | null;
    if (!g) continue;
    for (const [lon, lat] of g.coordinates) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (minLon === Infinity) throw new Error("no track points");

  // stats from raw trkpt data — more robust than walking GeoJSON properties
  const trkpts = doc.getElementsByTagNameNS("*", "trkpt");
  let distanceKm = 0;
  let gain = 0;
  let hasEle = false;
  let prev: { lat: number; lon: number; ele: number | null; t: number | null } | null = null;
  let firstT: number | null = null;
  let lastT: number | null = null;
  const profile: ElePoint[] = [];
  let minEle = Infinity;
  let maxEle = -Infinity;

  for (let i = 0; i < trkpts.length; i++) {
    const p = trkpts[i];
    const lat = parseFloat(p.getAttribute("lat") ?? "");
    const lon = parseFloat(p.getAttribute("lon") ?? "");
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const eleEl = p.getElementsByTagNameNS("*", "ele")[0];
    const ele = eleEl ? parseFloat(eleEl.textContent ?? "") : null;
    const timeEl = p.getElementsByTagNameNS("*", "time")[0];
    const t = timeEl ? Date.parse(timeEl.textContent ?? "") : null;

    if (prev) {
      const segKm = haversineKm(prev.lat, prev.lon, lat, lon);
      distanceKm += segKm;
      if (ele != null && prev.ele != null && ele > prev.ele) gain += ele - prev.ele;
      if (ele != null) hasEle = true;
      if (ele != null && isFinite(ele)) {
        profile.push([distanceKm, ele]);
        if (ele < minEle) minEle = ele;
        if (ele > maxEle) maxEle = ele;
      }
    } else if (ele != null && isFinite(ele)) {
      hasEle = true;
      profile.push([0, ele]);
      minEle = ele;
      maxEle = ele;
    }
    if (t != null && isFinite(t)) {
      if (firstT == null) firstT = t;
      lastT = t;
    }
    prev = { lat, lon, ele: isFinite(ele ?? NaN) ? ele : null, t };
  }

  const nameEl = doc.getElementsByTagNameNS("*", "trk")[0]?.getElementsByTagNameNS("*", "name")[0];
  const routeName = nameEl?.textContent?.trim();

  return {
    name: routeName || fallbackName,
    bounds: [minLon, minLat, maxLon, maxLat],
    geojson: fc,
    stats: {
      distanceKm,
      elevationGainM: hasEle ? gain : null,
      durationS: firstT != null && lastT != null ? Math.max(0, (lastT - firstT) / 1000) : null,
    },
    profile: profile.length > 1 ? { points: profile, minEle, maxEle } : null,
  };
}


function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
