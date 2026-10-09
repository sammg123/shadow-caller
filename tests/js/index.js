// Lets `node --test tests/js/` work (ui-architecture.md decision 8). Since Node 21 the test runner treats its
// arguments as globs, so a bare directory is run as a module: node resolves it to this index.js, which loads every
// *.test.mjs here in name order. `npm run test:js` (the glob, one process per file) stays the canonical runner.
import { readdirSync } from "node:fs";

const HERE = new URL("./", import.meta.url);
const TEST_FILES = readdirSync(HERE).filter((name) => name.endsWith(".test.mjs")).sort();

for (const name of TEST_FILES) await import(new URL(name, HERE).href);
