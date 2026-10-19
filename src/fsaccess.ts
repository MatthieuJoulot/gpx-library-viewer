// File-system access layer.
// Mode A (Chromium): File System Access API — user picks GPX directories,
//   permissions persist; Rescan re-reads all of them.
// Mode B (any browser): legacy webkitdirectory input — one-shot folder upload.
// Both funnel into the same TrackMeta[] pipeline.
//
// Collection identity = "libraryName/::/subfolder" so two libraries that both
// contain a "rando-france" subfolder stay distinct (colors, filters, list).

import type { TrackMeta } from "./gpx";
import { parseGpx } from "./gpx";

let dirHandles = new Map<string, FileSystemDirectoryHandle>();

export function hasFsAccessApi(): boolean {
  return "showDirectoryPicker" in window;
}

/** Pick a new library directory and ADD it to the loaded set.
 *  Containment-aware: adding a folder already covered by a loaded library is a
 *  no-op; adding a PARENT of loaded libraries supersedes them (no duplicates). */
export async function addDirectory(): Promise<TrackMeta[]> {
  const handle = await (window as unknown as { showDirectoryPicker(opts?: unknown): Promise<FileSystemDirectoryHandle> })
    .showDirectoryPicker({ mode: "read" });

  // is `handle` inside any loaded library?
  for (const existing of [...dirHandles.values()]) {
    const inside = await (existing as FileSystemDirectoryHandle & { resolve?: (h: FileSystemHandle) => Promise<string[] | null> })
      .resolve?.(handle);
    if (inside) {
      // already covered by the existing library — nothing new to add
      return await rescan();
    }
  }
  // does `handle` contain any loaded library? those become redundant
  for (const existing of [...dirHandles.values()]) {
    const covers = await (handle as FileSystemDirectoryHandle & { resolve?: (h: FileSystemHandle) => Promise<string[] | null> })
      .resolve?.(existing);
    if (covers) dirHandles.delete(existing.name);
  }
  dirHandles.set(handle.name, handle); // same-name dir = replace
  return await rescan();
}

/** Re-read every added library directory. Track ids deduped across libraries. */
export async function rescan(): Promise<TrackMeta[]> {
  if (!dirHandles.size) throw new Error("no directory selected");
  const batches = await Promise.all([...dirHandles.values()].map((h) => readDirectory(h)));
  const byId = new Map<string, TrackMeta>();
  for (const t of batches.flat()) byId.set(t.id, t); // same id: first read wins
  return [...byId.values()];
}

/** Read sheets.json (or any .json) at the root of an added library directory. */
export async function readLibraryFile(name: string): Promise<string | null> {
  for (const handle of dirHandles.values()) {
    try {
      const fh = await handle.getFileHandle(name);
      const file = await fh.getFile();
      return await file.text();
    } catch {
      // not in this library — try next
    }
  }
  return null;
}

async function readDirectory(root: FileSystemDirectoryHandle): Promise<TrackMeta[]> {
  const tracks: TrackMeta[] = [];
  const jobs: Promise<unknown>[] = [];
  const lib = root.name;

  for await (const entry of root as unknown as AsyncIterable<FileSystemHandle>) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".gpx")) {
      jobs.push(loadOne(entry as FileSystemFileHandle, lib, ""));
    } else if (entry.kind === "directory") {
      jobs.push(readSubdir(entry as FileSystemDirectoryHandle, lib, entry.name).then((r) => tracks.push(...r)));
    }
  }
  await Promise.all(jobs);
  return tracks;

  async function readSubdir(dir: FileSystemDirectoryHandle, libName: string, coll: string): Promise<TrackMeta[]> {
    const out: TrackMeta[] = [];
    const jobs: Promise<unknown>[] = [];
    for await (const entry of dir as unknown as AsyncIterable<FileSystemHandle>) {
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".gpx")) {
        jobs.push(loadOne(entry as FileSystemFileHandle, libName, coll));
      } else if (entry.kind === "directory") {
        // flatten deeper nesting into the top-level subfolder name
        jobs.push(readSubdir(entry as FileSystemDirectoryHandle, libName, coll).then((r) => out.push(...r)));
      }
    }
    await Promise.all(jobs);
    return out;
  }

  async function loadOne(fileHandle: FileSystemFileHandle, libName: string, sub: string): Promise<void> {
    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      const parsed = parseGpx(text, file.name.replace(/\.gpx$/i, ""));
      const collection = sub ? `${libName}/::/${sub}` : libName;
      tracks.push({
        id: `${collection}/${file.name}`,
        collection,
        fileName: file.name,
        ...parsed,
      });
    } catch {
      // skip unreadable/malformed files silently — list stays clean
    }
  }
}

/** Legacy folder input (Safari/Firefox): builds TrackMeta[] from a FileList. */
export async function tracksFromFileList(files: FileList): Promise<TrackMeta[]> {
  const out: TrackMeta[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".gpx")) continue;
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
    const parts = rel.split("/").filter(Boolean);
    const lib = parts[0] ?? "lib";
    const sub = parts.length > 2 ? parts[parts.length - 2] : "";
    const collection = sub ? `${lib}/::/${sub}` : lib;
    try {
      const text = await file.text();
      const parsed = parseGpx(text, file.name.replace(/\.gpx$/i, ""));
      out.push({
        id: `${collection}/${file.name}`,
        collection,
        fileName: file.name,
        ...parsed,
      });
    } catch {
      // skip
    }
  }
  return out;
}
