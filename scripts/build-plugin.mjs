import { mkdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const rootDir = path.resolve(import.meta.dirname, "..");
const entryPoint = path.join(rootDir, "plugin", "educlaw-kernel", "index.ts");
const outdir = path.join(rootDir, "plugin", "educlaw-kernel", "dist");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: path.join(outdir, "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  sourcemap: false,
  external: ["openclaw", "openclaw/*"],
});

console.log("Built Educlaw OpenClaw plugin bundle.");
