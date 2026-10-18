// Shared test helpers: the example pack, its reference solutions, and which
// language runtimes are installed (Python and Ruby tests skip when missing).
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPack, LANG_META } from "../room/pack.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const EXAMPLE = join(HERE, "..", "examples", "starter-pack");
export const pack = loadPack(EXAMPLE);

export const reference = (drillId, lang) =>
  readFileSync(join(HERE, "fixtures", "solutions", `${drillId}.${LANG_META[lang].ext}`), "utf8");

const has = (bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
export const AVAILABLE = {
  typescript: true,
  python: has(process.env.PYTHON || "python3"),
  ruby: has(process.env.RUBY || "ruby"),
};

export function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "drillroom-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
