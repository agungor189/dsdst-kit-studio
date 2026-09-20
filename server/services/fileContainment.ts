import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

function assertOwnedDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Upload root must be a real directory");
  const real = fs.realpathSync(resolved);
  if (real !== resolved) throw new Error("Upload root or one of its parents is a symlink");
  const getuid = process.getuid;
  if (typeof getuid === "function" && stat.uid !== getuid()) throw new Error("Upload root is not owned by the server user");
  return real;
}

export function ensureOwnedUploadRoot(uploadRoot: string): string {
  const resolved = path.resolve(uploadRoot);
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("No existing upload-root parent");
    ancestor = parent;
  }
  assertOwnedDirectory(ancestor);
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  return assertOwnedDirectory(resolved);
}

export function ensureOwnedUploadDirectory(uploadRoot: string, segments: readonly string[]): string {
  const root = ensureOwnedUploadRoot(uploadRoot);
  if (!segments.length || segments.some((segment) => segment !== ".quarantine" && !/^[A-Za-z0-9_-]+$/.test(segment))) throw new Error("Unsafe upload directory");
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Upload directory contains a symlink");
    const real = fs.realpathSync(current);
    if (real !== current || !inside(root, real)) throw new Error("Upload directory escapes the server-owned root");
  }
  return current;
}

type Resolution =
  | { status: "resolved"; absolutePath: string }
  | { status: "missing"; absolutePath: string }
  | { status: "rejected"; reason: string };

function resolveOwnedUploadFile(uploadRoot: string, storedPath: string): Resolution {
  let decoded = String(storedPath || "").normalize("NFKC").trim();
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return { status: "rejected", reason: "invalid_encoding" };
  }
  const normalized = decoded.replace(/\\/g, "/");
  if (!normalized.startsWith("/uploads/") || normalized.includes("\0")) return { status: "rejected", reason: "invalid_stored_path" };
  const relative = normalized.slice("/uploads/".length);
  const segments = relative.split("/");
  if (!relative || segments.some((segment) => !segment || segment === "." || segment === "..")) return { status: "rejected", reason: "invalid_stored_path" };

  let root: string;
  try {
    root = ensureOwnedUploadRoot(uploadRoot);
  } catch {
    return { status: "rejected", reason: "unsafe_upload_root" };
  }
  const candidate = path.resolve(root, ...segments);
  if (!inside(root, candidate)) return { status: "rejected", reason: "path_escape" };
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error: any) {
      if (error?.code === "ENOENT") return { status: "missing", absolutePath: candidate };
      throw error;
    }
    if (stat.isSymbolicLink()) return { status: "rejected", reason: "symlink" };
    if (index < segments.length - 1 && !stat.isDirectory()) return { status: "rejected", reason: "invalid_parent" };
    if (index === segments.length - 1 && !stat.isFile()) return { status: "rejected", reason: "not_a_file" };
  }
  if (fs.realpathSync(candidate) !== candidate) return { status: "rejected", reason: "non_canonical_file" };
  return { status: "resolved", absolutePath: candidate };
}

export type OwnedUploadRemoval = "deleted" | "missing" | "rejected" | "cleanup_pending";

export function removeOwnedUploadFile(uploadRoot: string, storedPath: string): OwnedUploadRemoval {
  const resolved = resolveOwnedUploadFile(uploadRoot, storedPath);
  if (resolved.status !== "resolved") return resolved.status;
  fs.unlinkSync(resolved.absolutePath);
  return "deleted";
}

export function removeOwnedUploadReference(
  uploadRoot: string,
  storedPath: string,
  deleteReference: () => void,
  operations: { rename?: typeof fs.renameSync; unlink?: typeof fs.unlinkSync } = {},
): OwnedUploadRemoval {
  const resolved = resolveOwnedUploadFile(uploadRoot, storedPath);
  if (resolved.status !== "resolved") {
    deleteReference();
    return resolved.status;
  }
  const root = ensureOwnedUploadRoot(uploadRoot);
  const quarantine = ensureOwnedUploadDirectory(root, [".quarantine"]);
  const quarantinedPath = path.join(quarantine, `${crypto.randomUUID()}.trash`);
  const rename = operations.rename || fs.renameSync;
  const unlink = operations.unlink || fs.unlinkSync;
  rename(resolved.absolutePath, quarantinedPath);
  try {
    deleteReference();
  } catch (error) {
    try {
      rename(quarantinedPath, resolved.absolutePath);
    } catch (rollbackError) {
      const failure = new Error("Database mutation failed and quarantined file restore failed", { cause: error }) as Error & { recoveryPath?: string; rollbackError?: unknown };
      failure.recoveryPath = quarantinedPath;
      failure.rollbackError = rollbackError;
      throw failure;
    }
    throw error;
  }
  try {
    unlink(quarantinedPath);
    return "deleted";
  } catch {
    return "cleanup_pending";
  }
}

export function finalizeOwnedUploadCleanup(uploadRoot: string, quarantinedPath: string): "deleted" | "missing" | "rejected" {
  let root: string;
  let quarantine: string;
  try {
    root = ensureOwnedUploadRoot(uploadRoot);
    quarantine = ensureOwnedUploadDirectory(root, [".quarantine"]);
  } catch {
    return "rejected";
  }
  const candidate = path.resolve(String(quarantinedPath || ""));
  if (path.dirname(candidate) !== quarantine || !inside(root, candidate)) return "rejected";
  try {
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(candidate) !== candidate) return "rejected";
    fs.unlinkSync(candidate);
    return "deleted";
  } catch (error: any) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}
