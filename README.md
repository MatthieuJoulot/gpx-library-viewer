# GPX Library

Browse a directory of GPX files on an interactive map with a searchable,
expandable list. Click a path or a list item to see its details: distance,
elevation gain, duration, elevation profile, and links to the original
route sheet (if you provide a `sheets.json` metadata file).

![screenshot placeholder](docs/screenshot.png)

## Features

- **Folder-based libraries** — pick one or more GPX directories; subfolders
  become collections, each with a stable color on map and list
- **Two-way selection** — click a path on the map to expand + scroll to its
  list item; click a list item to zoom to its path
- **Details panel** — distance, elevation gain, duration, file name,
  elevation profile sparkline, and route-sheet/Komoot links when joined
- **Filters** — by collection, distance range, elevation-gain range, and
  free-text search; one-click reset
- **Basemaps** — OpenStreetMap, CyclOSM, Esri satellite (all keyless)
- **Add folders, rescan** — multiple library folders; containment-aware
  (re-adding a parent or child of a loaded folder never duplicates)
- **Elevation profiles** — computed from `<ele>` data, rendered as SVG
  sparklines

## Run

```bash
npm install
npm run dev
# open http://localhost:5173, click "Choose folder…", pick a directory of GPX files
```

Chromium recommended (Chrome/Edge): folder permissions persist and
**Rescan** re-reads the directory to pick up newly added files.
Safari/Firefox work via one-shot folder upload; Rescan is unavailable there
(browsers don't allow re-reading a folder after upload).

## Metadata join (optional)

If your GPX root contains a `sheets.json` file (array of
`{ url, name, komoot, gpx }` entries — e.g. scraped route-sheet metadata),
tracks get linked to their route page and Komoot tour, and the list shows
clean titles instead of raw filenames. Matching is accent/punctuation
insensitive (validated on a 460-file corpus: 460/460 joined).

## Build

```bash
npm run build   # outputs static site to dist/
```

## Tech

Vite + TypeScript, MapLibre GL JS (raster tiles), `@tmcw/togeojson`.
No backend, no API keys, no tracking — all processing is local.

## License

MIT
