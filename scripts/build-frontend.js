// Lexica frontend build.
// Concatenates static/src/*.jsx (in filename order — the numeric prefixes set
// the order) into a SINGLE compilation unit, then runs Babel (preset-react) to
// produce static/app.js — the classic <script> the browser loads.
//
// Why concatenate before compiling (instead of `babel static/src --out-file`):
// compiling each file separately makes Babel inject its `_extends` spread-helper
// once PER FILE. One combined unit emits it once, and reproduces the exact output
// of the old single-file `babel static/app.jsx` build (the source files joined
// with "\n" reconstruct the original app.jsx byte-for-byte).
//
// Run: `npm run build` (Node runs locally on the dev machine; never needed on PA).
const babel = require('@babel/core');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'static', 'src');
const outFile = path.join(root, 'static', 'app.js');

const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.jsx')).sort();
if (!files.length) { console.error('No .jsx source files in static/src'); process.exit(1); }

const code = files.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');

const out = babel.transformSync(code, {
  presets: ['@babel/preset-react'],
  babelrc: false,
  configFile: false,
  filename: 'app.jsx',
  cwd: root,
});

// @babel/cli appends a trailing newline; match it so the committed app.js is stable.
fs.writeFileSync(outFile, out.code.endsWith('\n') ? out.code : out.code + '\n');
console.log(`Built ${outFile} from ${files.length} files: ${files.join(', ')}`);
