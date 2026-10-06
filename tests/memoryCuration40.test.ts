// ============================================================
// ISSUE #40 — Memory curation: merge dedupe + TTL visibility
// ============================================================

import {
  tokenizeForSimilarity,
  jaccardSimilarity,
} from "../src/engine/kumaGotchas.js";

describe("issue #40 memory curation", () => {
  test("duplicate-write fixture merges (high similarity)", () => {
    const a = tokenizeForSimilarity("Drizzle cross-branch DROP TABLE hazard in migration");
    const b = tokenizeForSimilarity("Drizzle cross branch DROP TABLE hazard in migrations");
    expect(jaccardSimilarity(a, b)).toBeGreaterThanOrEqual(0.6);
  });

  test("unrelated gotchas do not merge (low similarity)", () => {
    const a = tokenizeForSimilarity("Fastify response-schema property-stripping bug");
    const b = tokenizeForSimilarity("Drizzle cross-branch DROP TABLE hazard");
    expect(jaccardSimilarity(a, b)).toBeLessThan(0.6);
  });

  test("empty descriptions never merge", () => {
    expect(jaccardSimilarity(new Set(), tokenizeForSimilarity("x"))).toBe(0);
  });
});
