// Bundles src/ into a single self-contained HTML file.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = "index.html";

// The map data is embedded as JSON text read with JSON.parse, which browsers take in far faster
// than the same data written as JavaScript.
const jsonAsText = {
  name: "json-as-text",
  setup(b) {
    b.onLoad({ filter: /\.json$/ }, (args) => ({
      contents: `export default JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(readFileSync(args.path, "utf8"))))});`,
      loader: "js",
    }));
  },
};

const js = await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome110", "safari16", "firefox115"],
  plugins: [jsonAsText],
  legalComments: "none",
  metafile: true,
  write: false,
});
const css = await build({ entryPoints: ["src/styles.css"], bundle: true, minify: true, write: false });

// The licenses of the libraries bundled into the page, kept at its end.
const packages = [...new Set(Object.keys(js.metafile.inputs).map((p) => p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter(Boolean))].sort();
const notices = packages.map((name) => {
  const dir = join("node_modules", name);
  const { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  const text = file ? readFileSync(join(dir, file), "utf8").trim() : `${license} license`;
  return `${name} ${version}\n\n${text}`;
});
const licenses = `<!--\nThird-party software in this page:\n\n${notices.join("\n\n----\n\n").replace(/--+>/g, "- ->")}\n-->\n`;

const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html =
  readFileSync("src/index.html", "utf8")
    .replace("/*__CSS__*/", () => css.outputFiles[0].text)
    .replace("/*__JS__*/", () => script) + licenses;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`${OUT}  ${(html.length / 1024).toFixed(0)} KB`);
