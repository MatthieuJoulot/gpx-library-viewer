// A collection = a source library directory (the folder you picked).
// Subfolders become groups WITHIN the collection, shown as "Lib / Sub".
// Every track gets its OWN color (trackColorMap in main.ts); collection
// colors only remain as UI fallbacks (header/filter swatch gradients).

import type { TrackMeta } from "./gpx";
import { colorFor, trackColorFor } from "./format";

export interface Collection {
  key: string; // unique: "lib" or "lib/::/sub"
  lib: string; // root library name (picked folder)
  sub: string; // subfolder name, "" if none
  color: string;
  tracks: TrackMeta[];
}

export interface CollColorMap {
  get(key: string): string | undefined;
}

/** Group tracks by their collection key. Pass colorMap to keep colors stable
 *  when the track list is a filtered subset of the full library. */
export function groupByCollection(tracks: TrackMeta[], colorMap?: CollColorMap): Collection[] {
  const map = new Map<string, TrackMeta[]>();
  for (const t of tracks) {
    const list = map.get(t.collection);
    if (list) list.push(t);
    else map.set(t.collection, [t]);
  }
  const keys = [...map.keys()].sort((a, b) => a.localeCompare(b));
  return keys.map((k, i) => {
    const [lib, sub] = k.split("/::/");
    return {
      key: k,
      lib,
      sub: sub ?? "",
      color: colorMap?.get(k) ?? colorFor(i), // fallback: full-list order
      tracks: (map.get(k) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

/** Shared collection→color map derived from the FULL library. */
export function collectionColorMap(tracks: TrackMeta[]): Map<string, string> {
  const colls = groupByCollection(tracks);
  return new Map(colls.map((c) => [c.key, c.color]));
}

/** Shared track→color map derived from the FULL library, keyed by track id.
 *  Every track gets its own color (not one color per collection). Derived
 *  once from the full list so colors stay stable across filter changes. */
export function trackColorMap(tracks: TrackMeta[]): Map<string, string> {
  return new Map(tracks.map((t, i) => [t.id, trackColorFor(i)]));
}

export function collectionLabel(c: { lib: string; sub: string }): string {
  return c.sub ? `${c.lib} / ${c.sub}` : c.lib;
}

export function matchesQuery(t: TrackMeta, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    t.name.toLowerCase().includes(needle) ||
    t.fileName.toLowerCase().includes(needle) ||
    t.collection.toLowerCase().includes(needle)
  );
}
