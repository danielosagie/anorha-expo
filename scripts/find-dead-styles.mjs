#!/usr/bin/env node
// find-dead-styles.mjs — find (and optionally delete) dead StyleSheet.create keys.
//
// A key is DEAD when the sheet variable is only ever used as static property
// access (`sheet.key`) within its own file and no such access names the key.
// Safety rails (any of these marks the WHOLE sheet as untouchable):
//   - the sheet identifier is used dynamically (`sheet[expr]`), spread, passed
//     as a value, re-exported, or referenced any way that is not `sheet.key`
//   - the sheet is exported (another file may reach any key)
//
// Usage:
//   node scripts/find-dead-styles.mjs            # report only
//   node scripts/find-dead-styles.mjs --fix      # delete dead keys in place
//   node scripts/find-dead-styles.mjs --fix path/to/File.tsx   # limit scope
//
// Keep this script committed — rerun after any big screen refactor.

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIX = process.argv.includes('--fix');
const onlyFiles = process.argv.slice(2).filter((a) => a !== '--fix').map((f) => path.resolve(ROOT, f));

const SKIP_DIRS = new Set(['node_modules', '_backups', '.git', 'ios', 'android', 'scripts', '__tests__']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(path.join(dir, e.name));
    } else if (/\.(tsx?|jsx?)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      yield path.join(dir, e.name);
    }
  }
}

const targets = onlyFiles.length
  ? onlyFiles
  : [...walk(path.join(ROOT, 'src')), path.join(ROOT, 'App.tsx')].filter((f) => fs.existsSync(f));

let totalDead = 0;
let totalFiles = 0;
const report = [];

for (const file of targets) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('StyleSheet.create')) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // 1) collect sheets: varName -> { props: Map<key, {start,end}>, createNode, exported }
  const sheets = new Map();
  function collect(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sf) === 'StyleSheet.create' &&
      node.initializer.arguments.length === 1 &&
      ts.isObjectLiteralExpression(node.initializer.arguments[0]) &&
      ts.isIdentifier(node.name)
    ) {
      const obj = node.initializer.arguments[0];
      const props = new Map();
      for (const p of obj.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
          props.set(p.name.text, { start: p.getFullStart(), end: p.getEnd(), node: p });
        } else {
          // computed key / spread inside create → untouchable sheet
          props.clear();
          sheets.set(node.name.text, { props, createNode: obj, unsafe: true });
          return;
        }
      }
      const stmt = node.parent?.parent; // VariableStatement
      const exported =
        (ts.isVariableStatement(stmt) && stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) || false;
      sheets.set(node.name.text, { props, createNode: obj, unsafe: exported, exported });
    }
    ts.forEachChild(node, collect);
  }
  collect(sf);
  if (sheets.size === 0) continue;

  // export { s as x } style re-exports also make a sheet untouchable
  function checkExports(node) {
    if (ts.isExportSpecifier(node)) {
      const local = (node.propertyName ?? node.name).text;
      if (sheets.has(local)) sheets.get(local).unsafe = true;
    }
    ts.forEachChild(node, checkExports);
  }
  checkExports(sf);

  // 2) scan usages of each sheet identifier
  const used = new Map([...sheets.keys()].map((k) => [k, new Set()]));
  function scan(node) {
    if (ts.isIdentifier(node) && sheets.has(node.text)) {
      const sheet = sheets.get(node.text);
      const p = node.parent;
      const inOwnDecl =
        (ts.isVariableDeclaration(p) && p.name === node) ||
        (ts.isExportSpecifier(p));
      if (!inOwnDecl) {
        if (ts.isPropertyAccessExpression(p) && p.expression === node) {
          used.get(node.text).add(p.name.text);
        } else if (ts.isPropertyAccessExpression(p) || ts.isQualifiedName(p)) {
          // sheet appears as the NAME side (obj.sheet) — unrelated symbol; ignore
          if (p.name === node) {
            /* different symbol with same name — conservative: mark unsafe */
            sheet.unsafe = true;
          }
        } else {
          // element access, spread, argument, shorthand property, etc.
          sheet.unsafe = true;
        }
      }
    }
    ts.forEachChild(node, scan);
  }
  scan(sf);

  // 3) compute dead keys
  const deadRanges = [];
  const fileReport = [];
  for (const [name, sheet] of sheets) {
    if (sheet.unsafe) continue;
    const u = used.get(name);
    for (const [key, range] of sheet.props) {
      if (!u.has(key)) {
        fileReport.push(`${name}.${key}`);
        deadRanges.push(range);
      }
    }
  }
  if (fileReport.length === 0) continue;
  totalDead += fileReport.length;
  totalFiles += 1;
  report.push({ file: path.relative(ROOT, file), dead: fileReport });

  // 4) fix: delete property ranges (extend over trailing comma), back to front
  if (FIX) {
    let out = text;
    deadRanges.sort((a, b) => b.start - a.start);
    for (const { start, end } of deadRanges) {
      let e = end;
      while (e < out.length && /[ \t]/.test(out[e])) e++;
      if (out[e] === ',') e++;
      out = out.slice(0, start) + out.slice(e);
    }
    fs.writeFileSync(file, out);
  }
}

for (const r of report.sort((a, b) => b.dead.length - a.dead.length)) {
  console.log(`${r.file}: ${r.dead.length} dead`);
  for (const k of r.dead) console.log(`  - ${k}`);
}
console.log(`\n${totalDead} dead style keys across ${totalFiles} files${FIX ? ' (deleted)' : ''}`);
