import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const OUT = "dist";
const FONT_DIR = "node_modules/@fontsource/pixelify-sans/files";

const entries = {
  background: "src/background/service-worker.ts",
  content: "src/content/index.ts",
  "popup/popup": "src/popup/popup.ts",
  "options/options": "src/options/options.ts",
  "sidepanel/sidepanel": "src/sidepanel/sidepanel.ts",
};

const pages = ["popup/popup", "options/options", "sidepanel/sidepanel"];

async function copyStatic() {
  await cp("static", OUT, { recursive: true });
  await mkdir(`${OUT}/styles`, { recursive: true });
  await cp("src/styles/theme.css", `${OUT}/styles/theme.css`);
  await cp("src/content/overlay.css", `${OUT}/content.css`);
  for (const p of pages) {
    await cp(`src/${p}.html`, `${OUT}/${p}.html`);
    await cp(`src/${p}.css`, `${OUT}/${p}.css`);
  }
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const manifest = JSON.parse(await readFile("static/manifest.json", "utf8"));
  manifest.version = pkg.version;
  await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
  await mkdir(`${OUT}/assets/fonts`, { recursive: true });
  for (const w of [400, 500, 600, 700]) {
    await cp(`${FONT_DIR}/pixelify-sans-latin-${w}-normal.woff2`, `${OUT}/assets/fonts/pixelify-${w}.woff2`);
  }
  if (!existsSync("static/assets/raphael-pixel.png")) {
    console.log("ℹ static/assets/raphael-pixel.png belum ada — jalankan scripts/make-portrait.py");
  }
}

const options = {
  entryPoints: entries,
  outdir: OUT,
  bundle: true,
  format: "iife",
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  plugins: [{ name: "static", setup: (b) => b.onEnd(() => copyStatic()) }],
};

await rm(OUT, { recursive: true, force: true });
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("Watching… (reload ekstensi di chrome://extensions setelah perubahan)");
} else {
  await build(options);
  console.log(`✓ Build selesai → ${OUT}/ (Load unpacked di chrome://extensions)`);
}
