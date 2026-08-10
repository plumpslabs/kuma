import { generateSkill } from "../src/utils/skillGenerator.js";

// All agent types supported by the skill generator.
const AGENT_TYPES = [
  "claude",
  "cursor",
  "cline",
  "antigravity",
  "codex",
  "opencode",
  "aider",
  "windsurf",
  "copilot",
  "qwen",
  "kiro",
  "openclaw",
  "codewhale",
] as const;

// XML delimiters wrap the obedience + workflow sections (matcha-style).
// They must stay balanced so the LLM sees hard instruction boundaries.
const TAGS = ["kuma_obedience", "kuma_workflow"] as const;

describe("skillGenerator XML delimiters", () => {
  for (const type of AGENT_TYPES) {
    test(`${type} skill has balanced XML delimiters`, () => {
      const skill = generateSkill(type);
      for (const tag of TAGS) {
        const open = (skill.match(new RegExp(`<${tag}>`, "g")) || []).length;
        const close = (skill.match(new RegExp(`</${tag}>`, "g")) || []).length;
        expect(open).toBeGreaterThan(0);
        expect(open).toBe(close);
      }
    });
  }

  test("opencode skill uses kuma_kuma_* prefix inside XML sections", () => {
    const skill = generateSkill("opencode");
    // The tool calls inside <kuma_obedience> must be prefixed, not bare.
    const obedience = skill.match(/<kuma_obedience>([\s\S]*?)<\/kuma_obedience>/)?.[1] ?? "";
    expect(obedience).toContain("kuma_kuma_context");
    // No BARE (unprefixed) kuma_context(...) call may appear.
    const bareCalls = obedience.match(/(?<![a-zA-Z_])kuma_context\(/g) ?? [];
    expect(bareCalls).toHaveLength(0);
  });

  test("all skills reference .kuma/init.md as the source of truth", () => {
    for (const type of AGENT_TYPES) {
      expect(generateSkill(type)).toContain(".kuma/init.md");
    }
  });
});
