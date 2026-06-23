// Syntax-checks every JS module in the project with `node --check`. This catches
// parse errors fast without needing a browser (it does not resolve imports).

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const roots = ["server", "src"];
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith(".js")) files.push(full);
  }
}
for (const r of roots) walk(r);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
    console.log("ok  " + f);
  } catch (err) {
    failed++;
    console.error("FAIL " + f);
    console.error((err.stderr || err.stdout || err.message).toString());
  }
}

console.log(`\n${files.length - failed}/${files.length} files passed syntax check`);
process.exit(failed ? 1 : 0);
