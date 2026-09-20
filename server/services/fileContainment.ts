import fs from "node:fs";
import path from "node:path";

const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

export function removeOwnedUploadFile(uploadRoot: string, storedPath: string): "deleted" | "missing" | "rejected" {
  let decoded = String(storedPath || "").normalize("NFKC").trim();
  try {
    for (let index = 0; index < 3; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return "rejected";
  }
  const normalized = decoded.replace(/\\/g, "/");
  if (!normalized.startsWith("/uploads/") || normalized.includes("\0")) return "rejected";
  const relative = normalized.slice("/uploads/".length);
  if (!relative || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) return "rejected";

  const root = path.resolve(uploadRoot);
  fs.mkdirSync(root, { recursive: true });
  const rootReal = fs.realpathSync(root);
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) return "rejected";
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error: any) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return "rejected";
  const candidateReal = fs.realpathSync(candidate);
  if (!inside(rootReal, candidateReal)) return "rejected";
  fs.unlinkSync(candidate);
  return "deleted";
}
