# GPX Library Viewer

A browser app for browsing a directory of GPX files on a map — think of it as
a library view for your GPS tracks. Every file in the folder (and its
subfolders) is plotted as a colored path, and listed in a sidebar organized by
collection. Click a path on the map to expand its entry in the list, click a
list entry to zoom to its route. No backend, no account, no uploads: your
files never leave your machine.

![screenshot placeholder](docs/screenshot.png)

## What it does

- **Folder-based libraries** — pick one or more GPX directories; subfolders
  become collections, each with a stable color shared between map and list
- **Two-way selection** — click a path to expand + scroll to its list entry;
  click a list entry to zoom to its path; `Esc` clears the selection
- **Details panel** — distance, elevation gain, duration, file name,
  elevation profile sparkline, and route-sheet/Komoot links when metadata
  is provided (see below)
- **Filters** — by collection, distance range, elevation-gain range, and
  free-text search; one-click **Reset**
- **Basemaps** — OpenStreetMap, CyclOSM, Esri satellite (all keyless)
- **Add folders & rescan** — load multiple directories; adding a parent or
  child of an already-loaded folder never duplicates tracks
- **Everything local** — parsing, filtering, and rendering all happen in
  your browser

## Using it

1. **Start the app** (Chromium recommended — see note below):

   ```bash
   npm install
   npm run dev
   ```

   Open http://localhost:5173.

2. **Load your GPX files.** Click **Choose folder…** and pick the directory
   containing your GPX files. Subfolders become collections (one color
   each). Add more folders with **+ Folder** in the footer.

3. **Browse and select.** Click a path on the map or an entry in the list —
   both stay in sync. The expanded entry shows stats and the elevation
   profile.

4. **Filter.** Use the checkboxes to show/hide collections, type min/max
   values for distance (km) or elevation gain (m), or search by name.
   **Reset** clears everything. The counter in the footer shows
   visible/total tracks.

5. **Rescan.** Added new files to the folder since loading? **Rescan**
   re-reads the directory and picks them up.

> **Browser note:** Chromium (Chrome/Edge) recommended. Browsers with the
> File System Access API keep folder permission for the session, so
> **Rescan** works. Safari/Firefox use a one-shot folder upload: everything
> works except Rescan (the browser doesn't allow re-reading a folder after
> upload), and re-picking a folder replaces the current library.

## Optional: route-sheet metadata (sheets.json)

If your GPX root contains a `sheets.json` file — an array of
`{ url, name, komoot, gpx }` entries (for example, scraped route-sheet
metadata) — tracks get linked to their route page and Komoot tour, and the
list shows clean titles instead of raw filenames. Matching ignores accents,
punctuation, and case (validated on a 460-file corpus: 460/460 joined).

**GPX files without a matching sheets.json entry are fully supported** —
they simply show their normal stats and filename; the links section is just
omitted.

## Build

```bash
npm run build   # outputs a static site to dist/
```

## Tech

Vite + TypeScript, MapLibre GL JS (raster tiles), `@tmcw/togeojson`.
No backend, no API keys, no tracking — all processing is local.

## License

MIT — see [LICENSE](LICENSE).
