// Production bundler for the API and worker. Run from the app directory:
//   node ../../scripts/bundle-service.mjs src/server.ts dist/server.js
// Workspace packages (@scopepilot/*) export TypeScript source, so they are compiled into the bundle.
// Third-party packages stay external and are loaded from the app's node_modules at runtime; the build
// fails if one of them is not resolvable from the app, because the bundle would crash on start.
import { build } from "esbuild";
import { existsSync, rmSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("Usage: bundle-service.mjs <entry.ts> <outfile.js>");
  process.exit(2);
}

const appDir = process.cwd();
const builtins = new Set(builtinModules);
const unresolved = new Set();

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function resolvableFromApp(name) {
  for (let dir = appDir; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "node_modules", name, "package.json"))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

const externalThirdParty = {
  name: "external-third-party",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("node:") || builtins.has(args.path)) return { path: args.path, external: true };
      const name = packageName(args.path);
      if (name.startsWith("@scopepilot/")) return undefined;
      if (!resolvableFromApp(name)) unresolved.add(`${name} (imported by ${path.relative(appDir, args.importer)})`);
      return { path: args.path, external: true };
    });
  },
};

rmSync(path.join(appDir, path.dirname(outfile)), { recursive: true, force: true });
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  legalComments: "none",
  logLevel: "warning",
  plugins: [externalThirdParty],
});

if (unresolved.size > 0) {
  console.error(`Build failed: these packages are not dependencies of ${path.basename(appDir)}:\n  ${[...unresolved].join("\n  ")}`);
  process.exit(1);
}
console.log(`Built ${outfile} (${(statSync(path.join(appDir, outfile)).size / 1024).toFixed(1)} KiB)`);
