const path = require('path');
const esbuild = require("esbuild");
const {sassPlugin} = require("esbuild-sass-plugin");

esbuild.build({
    entryPoints: [path.join(__dirname, 'src/renderer/customMarkdownRenderer.js')],
    bundle: true,
    format: 'esm',
    // minify: true,
    platform: 'browser',
    outfile: path.join(__dirname, 'out/customMarkdownRenderer.js'),
    plugins: [
        sassPlugin({type: "style"})
    ]

}).catch(() => process.exit(1));

esbuild.build({
    entryPoints: [path.join(__dirname, 'src/extension/extension.ts'),
                  path.join(__dirname, 'src/extension/openaiInterface.ts')],
    bundle: true,
    format: 'cjs',
    // minify: true,
    platform: 'node',
    outdir: path.join(__dirname, 'out'),
    external: ['vscode']
}).catch(() => process.exit(1));