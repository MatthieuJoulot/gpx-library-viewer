// Join GPX tracks with Recto Verso sheets.json metadata.
// Matching validated against the real corpus: 460/460 files join via
// normalized-name containment (accents/punctuation/case-insensitive).

export interface SheetMeta {
  name: string;
  url: string; // Recto Verso route sheet page
  komoot?: string; // Komoot tour link
  gpx?: string; // original GPX download URL
  number?: string;
}

/** Parse raw sheets.json array (entries with url/name/komoot/gpx keys). */
export function parseSheets(data: unknown): SheetMeta[] {
  if (!Array.isArray(data)) return [];
  const out: SheetMeta[] = [];
  for (const e of data) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    if (typeof o.url !== "string" || typeof o.name !== "string") continue;
    const komoot = Array.isArray(o.komoot) && typeof o.komoot[0] === "string" ? o.komoot[0] : undefined;
    const gpxArr = Array.isArray(o.gpx) ? (o.gpx[0] as unknown) : undefined;
    const gpx = Array.isArray(gpxArr) && typeof gpxArr[0] === "string" ? gpxArr[0] : undefined;
    out.push({
      name: o.name,
      url: o.url,
      komoot,
      gpx,
      number: typeof o.number === "string" ? o.number : undefined,
    });
  }
  return out;
}

function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Clean a local filename into a comparable title: strip "NN - " prefix + extension. */
export function cleanFileTitle(fileName: string): string {
  return fileName
    .replace(/\.gpx$/i, "")
    .replace(/^\s*\d+\s*[-–—]?\s*/, "")
    .trim();
}

/** Build a join key → SheetMeta map for a set of tracks. */
export function buildJoin(
  tracks: { id: string; collection: string; fileName: string }[],
  sheets: SheetMeta[],
): Map<string, SheetMeta> {
  // index sheets by normalized name AND by normalized gpx-url basename
  const byName = new Map<string, SheetMeta>();
  const byGpxBase = new Map<string, SheetMeta>();
  for (const s of sheets) {
    const n = norm(s.name);
    if (n && !byName.has(n)) byName.set(n, s);
    if (s.gpx) {
      const base = norm(decodeURIComponent(s.gpx.split("/").pop() ?? "").replace(/\.gpx$/i, ""));
      if (base && !byGpxBase.has(base)) byGpxBase.set(base, s);
    }
  }

  const out = new Map<string, SheetMeta>();
  for (const t of tracks) {
    // collection hint: sheet url contains "<coll>/randonnee-..." segment
    const collHint = norm(t.collection.split("/::/").pop() ?? "");
    const title = norm(cleanFileTitle(t.fileName));

    let best: SheetMeta | null = null;
    // 1) exact gpx basename match
    if (byGpxBase.has(title)) best = byGpxBase.get(title)!;
    // 2) exact title match, prefer same collection
    if (!best) {
      const cands = [...byName.entries()].filter(([k]) => k === title);
      const withColl = cands.find(([, s]) => collHint && norm(s.url).includes(collHint));
      best = withColl?.[1] ?? cands[0]?.[1] ?? null;
    }
    // 3) containment either way (title ⊂ sheet name or sheet name ⊂ title)
    if (!best && title) {
      let cands: SheetMeta[] = [];
      for (const [k, s] of byName) {
        if ((k.includes(title) || title.includes(k)) && Math.abs(k.length - title.length) < 40) {
          cands.push(s);
        }
      }
      const withColl = cands.find((s) => collHint && norm(s.url).includes(collHint));
      best = withColl ?? cands[0] ?? null;
    }
    if (best) out.set(t.id, best);
  }
  return out;
}
