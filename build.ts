import type { PluginBuild, OnLoadArgs } from 'esbuild';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const commonOptions = {
  bundle: true,
  platform: 'node' as const,
  target: 'node20',
  format: 'cjs' as const,
  outExtension: { '.js': '.cjs' },
  banner: { js: '#!/usr/bin/env node' },
};

const jsdomCss = fs.readFileSync(
  path.resolve('node_modules/jsdom/lib/jsdom/browser/default-stylesheet.css'),
  'utf8',
);
const jsdomWorkerSrc = fs.readFileSync(
  path.resolve('node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js'),
  'utf8',
);

const cssTreePatch = fs.readFileSync(path.resolve('node_modules/css-tree/data/patch.json'), 'utf8');
const cssTreeVersion = JSON.parse(
  fs.readFileSync(path.resolve('node_modules/css-tree/package.json'), 'utf8'),
).version as string;

const jsdomInlinePlugin = {
  name: 'inline-jsdom-fs-deps',
  setup(build: PluginBuild) {
    // css-tree uses createRequire(import.meta.url) which is undefined when bundled to CJS
    // Use simple suffix filters to avoid Windows backslash issues
    build.onLoad({ filter: /data-patch\.js$/ }, (args: OnLoadArgs) => {
      if (!args.path.includes('css-tree')) return null;
      return { contents: `export default ${cssTreePatch};`, loader: 'js' };
    });
    build.onLoad({ filter: /version\.js$/ }, (args: OnLoadArgs) => {
      if (!args.path.includes('css-tree')) return null;
      return { contents: `export const version = ${JSON.stringify(cssTreeVersion)};`, loader: 'js' };
    });
    build.onLoad({ filter: /data\.js$/ }, (args: OnLoadArgs) => {
      if (!args.path.includes('css-tree')) return null;
      let code = fs.readFileSync(args.path, 'utf8');
      code = code.replace(`import { createRequire } from 'module';\n`, ``);
      code = code.replace(`const require = createRequire(import.meta.url);\n`, ``);
      return { contents: code, loader: 'js' };
    });

    build.onLoad(
      { filter: /style-rules\.js$/ },
      (args: OnLoadArgs) => {
        if (!args.path.includes('jsdom')) return null;
        let code = fs.readFileSync(args.path, 'utf8');
        code = code.replace(
          `const defaultStyleSheet = fs.readFileSync(\n  path.resolve(__dirname, "../../browser/default-stylesheet.css"),\n  { encoding: "utf-8" }\n);`,
          `const defaultStyleSheet = ${JSON.stringify(jsdomCss)};`,
        );
        return { contents: code, loader: 'js' };
      },
    );

    build.onLoad(
      { filter: /XMLHttpRequest-impl\.js$/ },
      (args: OnLoadArgs) => {
        if (!args.path.includes('jsdom')) return null;
        let code = fs.readFileSync(args.path, 'utf8');
        code = code.replace(
          `const syncWorkerFile = require.resolve("./xhr-sync-worker.js");`,
          `const syncWorkerSrc = ${JSON.stringify(jsdomWorkerSrc)};`,
        );
        code = code.replace(
          `new Worker(syncWorkerFile)`,
          `new Worker(syncWorkerSrc, { eval: true })`,
        );
        return { contents: code, loader: 'js' };
      },
    );

    build.onLoad(
      { filter: /CSSStyleRule\.js$/ },
      (args: OnLoadArgs) => {
        if (!args.path.includes('cssom')) return null;
        let code = fs.readFileSync(args.path, 'utf8');
        code = code.replace(`this.__style.parentRule = this;`, `this.__style._parentRule = this;`);
        return { contents: code, loader: 'js' };
      },
    );
  },
};

await Promise.all([
  build({
    ...commonOptions,
    entryPoints: ['src/websearch.ts'],
    outfile: 'skills/websearch/scripts/websearch.cjs',
  }),
  build({
    ...commonOptions,
    entryPoints: ['src/webfetch.ts'],
    outfile: 'skills/webfetch/scripts/webfetch.cjs',
    plugins: [jsdomInlinePlugin],
  }),
]);
