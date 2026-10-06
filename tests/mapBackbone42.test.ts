// ============================================================
// ISSUE #42 — Two-tier map bootstrap
// ============================================================

import {
  extractImportSources,
  formatBackbone,
  isMapEmpty,
  ensureBackbone,
} from "../src/engine/mapBackbone.js";
import { getIndexerStatus } from "../src/engine/impactAnalysis.js";

describe("issue #42 two-tier bootstrap", () => {
  test("import extraction: relative only, alias-tolerant", () => {
    expect(extractImportSources(`import { a } from './x';`)).toEqual(["./x"]);
    expect(extractImportSources(`import gmath "bench/pkg/gamma_math"`)).toEqual([]);
    expect(extractImportSources(`import gmath "./gamma_math"`)).toEqual(["./gamma_math"]);
    expect(extractImportSources(`from .utils import helper`)).toEqual([".utils"]);
    expect(extractImportSources(`from "./utils" import helper`)).toEqual(["./utils"]);
    expect(extractImportSources(`const x = require('./y');`)).toEqual(["./y"]);
    expect(extractImportSources(`import fs from "node:fs";`)).toEqual([]);
    expect(extractImportSources(`// import './commented';`)).toEqual([]);
  });

  test("mapped repo → backbone skipped (null), map not empty", async () => {
    expect(await isMapEmpty()).toBe(false);
    expect(await ensureBackbone()).toBeNull();
  });

  test("backbone report format carries timing + honesty note", () => {
    const out = formatBackbone({ files: 120, capped: false, nodes: 120, edges: 300, ms: 800, filesPerSec: 150 });
    expect(out).toContain("120 file(s)");
    expect(out).toContain("800ms");
    expect(out).toContain("approximate tier");
  });

  test("indexer status reports backbone flag honestly", async () => {
    const st = await getIndexerStatus();
    expect(typeof st.backboneOnly).toBe("boolean");
    expect(typeof st.note).toBe("string");
    if (st.backboneOnly) expect(st.note).toContain("Backbone-tier");
  });
});
