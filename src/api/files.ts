// File browsing for the WebUI: list and serve files from /workspace and /data/screenshots

import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { resolve, normalize, join, relative, extname } from "path";

export interface FileEntry {
  name: string;
  path: string; // absolute
  relpath: string; // relative to base
  size: number; // bytes
  modified: string; // ISO string
  ext: string; // lowercase, no dot
}

// Base directories that can be browsed
const BASE_DIRS: Record<string, string> = {
  workspace: "/workspace",
  screenshots: "/data/screenshots",
};

// Allowed roots for raw file serving (real path must be inside one of these)
const ALLOWED_ROOTS = ["/workspace", "/data/screenshots"];

// Blocked file patterns (mirrors src/tools/file.ts, kept self-contained)
const BLOCKED_FILE_PATTERNS = [
  /\.env$/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /credentials/i,
  /secrets?/i,
  /password/i,
  /token/i,
  /api_key/i,
  /private/i,
];

const MAX_LIST_RESULTS = 500;
const MAX_RAW_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function baseFor(dirKey: string): string {
  return BASE_DIRS[dirKey] ?? BASE_DIRS.workspace;
}

/** Recursively walk `base`, collecting file entries (files only, capped). */
function walk(base: string, dir: string, out: FileEntry[]): void {
  if (out.length >= MAX_LIST_RESULTS) return;

  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip
  }

  for (const entry of entries) {
    if (out.length >= MAX_LIST_RESULTS) return;
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(base, full, out);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      const stats = statSync(full);
      const ext = extname(entry.name).slice(1).toLowerCase();
      out.push({
        name: entry.name,
        path: full,
        relpath: relative(base, full),
        size: stats.size,
        modified: stats.mtime.toISOString(),
        ext,
      });
    } catch {
      // file vanished or unreadable — skip
    }
  }
}

/** List files under the base dir resolved from `dirKey`. Never throws. */
export function listFiles(dirKey: string): FileEntry[] {
  try {
    const base = baseFor(dirKey);
    if (!existsSync(base)) return [];

    const out: FileEntry[] = [];
    walk(base, base, out);
    out.sort((a, b) => b.modified.localeCompare(a.modified));
    return out.slice(0, MAX_LIST_RESULTS);
  } catch {
    return [];
  }
}

/** Validate a raw file path: must resolve inside an allowed root and not match secret patterns. */
export function validateFilePath(p: string): { ok: boolean; status?: number; reason?: string } {
  if (!p) {
    return { ok: false, status: 403, reason: "Access denied" };
  }

  let resolvedPath: string;
  try {
    resolvedPath = normalize(resolve(p));
  } catch {
    return { ok: false, status: 403, reason: "Access denied" };
  }

  // Must be within an allowed root
  const isAllowed = ALLOWED_ROOTS.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(root + "/")
  );
  if (!isAllowed) {
    return { ok: false, status: 403, reason: "Access denied" };
  }

  // Reject secret/credential patterns
  const lowerPath = resolvedPath.toLowerCase();
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(lowerPath)) {
      return { ok: false, status: 403, reason: "Access denied" };
    }
  }

  return { ok: true };
}

const TEXT_EXTS = new Set([
  "csv",
  "md",
  "json",
  "txt",
  "js",
  "ts",
  "py",
  "html",
  "xml",
  "yaml",
  "yml",
  "log",
]);

function contentTypeFor(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    default:
      return TEXT_EXTS.has(ext) ? "text/plain; charset=utf-8" : "application/octet-stream";
  }
}

/** Serve the raw bytes of a validated file with an appropriate Content-Type. */
export function serveRawFile(p: string): Response {
  const check = validateFilePath(p);
  if (!check.ok) {
    return json({ error: check.reason ?? "Access denied" }, check.status ?? 403);
  }

  const resolvedPath = normalize(resolve(p));

  if (!existsSync(resolvedPath)) {
    return json({ error: "Not found" }, 404);
  }

  let stats: import("fs").Stats;
  try {
    stats = statSync(resolvedPath);
  } catch {
    return json({ error: "Not found" }, 404);
  }

  if (!stats.isFile()) {
    return json({ error: "Not found" }, 404);
  }

  if (stats.size > MAX_RAW_FILE_SIZE) {
    return json({ error: "File too large" }, 413);
  }

  const ext = extname(resolvedPath).slice(1).toLowerCase();
  const contentType = contentTypeFor(ext);
  const data = readFileSync(resolvedPath);

  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "no-cache",
    },
  });
}
