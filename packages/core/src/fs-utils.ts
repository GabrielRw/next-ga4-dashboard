import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_SCAN_DIRS = ["app", "pages", "src", "components", "lib", "hooks", "utils"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".md", ".mdx"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await pathExists(filePath))) return null;
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function listSourceFiles(root: string, scanDirs = DEFAULT_SCAN_DIRS): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(absolute);
        continue;
      }
      if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
    }
  }

  for (const scanDir of scanDirs) {
    const absolute = path.join(root, scanDir);
    if (await pathExists(absolute)) await walk(absolute);
  }

  return files.sort();
}

export function toPosixRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

export function packageManagerFromLockfiles(root: string): Promise<string> {
  return Promise.all([
    pathExists(path.join(root, "pnpm-lock.yaml")),
    pathExists(path.join(root, "yarn.lock")),
    pathExists(path.join(root, "package-lock.json")),
    pathExists(path.join(root, "bun.lockb")),
  ]).then(([pnpm, yarn, npm, bun]) => {
    if (pnpm) return "pnpm";
    if (yarn) return "yarn";
    if (bun) return "bun";
    if (npm) return "npm";
    return "unknown";
  });
}
