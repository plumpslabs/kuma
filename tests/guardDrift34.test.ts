// ============================================================
// ISSUE #34 REGRESSION — only uncommitted + unverified state is drift
// ============================================================

import { buildDriftMessages } from "../src/utils/kumaShared.js";

describe("issue #34: drift semantics", () => {
  test("nothing modified → no drift", () => {
    expect(buildDriftMessages(0, false, 0, "")).toEqual([]);
  });

  test("modified but verified in-session → no drift", () => {
    expect(buildDriftMessages(3, true, 0, "")).toEqual([]);
  });

  test("uncommitted + unverified → exactly one actionable drift", () => {
    const drifts = buildDriftMessages(3, false, 0, "");
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatch(/3 file\(s\) edited but no test run/);
  });
});
