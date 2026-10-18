// Judge runner for TypeScript submissions.
//
// Usage: node runner-ts.mjs <solution.ts> <spec.json> <cases.json>
// spec.json is { name, args, adapter }: the function or class to look up, the
// arguments to pass in order (a case's arg name, or {value} for a fixed value),
// and an optional adapter module.
// Strips types with Node's built-in stripper (Node 22.13+), runs the code in a
// fresh VM context, and prints one line: MARKER + JSON list of {ok, got | error, logs}.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import * as nodeModule from "node:module";

const MARKER = "@@DRILLROOM_RESULTS@@";
const [path, specPath, casesPath] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const src = readFileSync(path, "utf8");

function out(results) {
  process.stdout.write(MARKER + JSON.stringify(results) + "\n");
}
const failAll = (error, logs = []) => {
  out(cases.map(() => ({ ok: false, error, logs })));
  process.exit(0);
};

if (!/^[A-Za-z_$][\w$]*$/.test(spec.name)) failAll(`The pack's call name ${JSON.stringify(spec.name)} isn't a JavaScript identifier.`);

function lineOf(err) {
  const m = String(err && err.stack || "").match(/solution\.ts:(\d+)/);
  return m ? ` (line ${m[1]})` : "";
}

// Sets become arrays and Maps become objects, so either shape can be compared.
function plain(v) {
  if (v === undefined) return null;
  if (v instanceof Set || (v && v.constructor && v.constructor.name === "Set" && typeof v.has === "function")) return Array.from(v, plain);
  if (v instanceof Map || (v && v.constructor && v.constructor.name === "Map" && typeof v.get === "function")) {
    return Object.fromEntries(Array.from(v, ([k, x]) => [String(k), plain(x)]));
  }
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = plain(v[k]);
    return o;
  }
  return v;
}

let logs = [];
const fmt = (x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })());
const fakeConsole = {};
for (const k of ["log", "info", "warn", "error", "debug"]) fakeConsole[k] = (...args) => logs.push(args.map(fmt).join(" "));

const sandbox = vm.createContext({ console: fakeConsole });

if (typeof nodeModule.stripTypeScriptTypes !== "function") {
  failAll(`TypeScript needs Node 22.13 or newer (you have ${process.versions.node}).`);
}

let js;
try {
  // `export function f` is fine in a solution, but the code runs as a script, so
  // drop the keyword (same length of line, so line numbers stay put).
  js = nodeModule.stripTypeScriptTypes(src, { mode: "strip" }).replace(/^([ \t]*)export[ \t]+(?!default\b)/gm, "$1");
} catch (e) {
  failAll(`SyntaxError: ${e.message}`);
}

let adapt = null;
if (spec.adapter) {
  try {
    adapt = (await import(pathToFileURL(spec.adapter).href)).default;
    if (typeof adapt !== "function") throw new Error("it has no default export function");
  } catch (e) {
    failAll(`The pack's adapter couldn't load: ${e.message}`);
  }
}

try {
  // Top-level classes and const/let functions aren't properties of the global
  // object, so expose the one the drill calls explicitly (on the last line, so
  // the solution's line numbers don't shift).
  vm.runInContext(`${js}\n;globalThis.__drillroomTarget = typeof ${spec.name} !== "undefined" ? ${spec.name} : undefined;`, sandbox, {
    filename: "solution.ts",
    timeout: 4000,
  });
} catch (e) {
  failAll(`${e.name || "Error"}: ${e.message}${lineOf(e)}`, logs.slice());
}
const loadLogs = logs;
const target = sandbox.__drillroomTarget;
if (target === undefined) {
  failAll(`ReferenceError: ${spec.name} is not defined. Keep the name from the starter code.`, loadLogs.slice());
}

const results = [];
for (const [i, c] of cases.entries()) {
  logs = i === 0 ? loadLogs.slice() : [];
  try {
    const args = JSON.parse(JSON.stringify(c.args));
    let got;
    if (adapt) got = await adapt(target, args);
    else if (typeof target !== "function") throw new TypeError(`${spec.name} is not a function`);
    else got = target(...spec.args.map((a) => (typeof a === "string" ? args[a] : a.value)));
    results.push({ ok: true, got: got === undefined ? null : JSON.parse(JSON.stringify(plain(got))), logs: logs.slice() });
  } catch (e) {
    const name = e && e.name ? e.name : "Error";
    const msg = e && e.message ? e.message : String(e);
    results.push({ ok: false, error: `${name}: ${msg}${lineOf(e)}`, logs: logs.slice() });
  }
}
out(results);
