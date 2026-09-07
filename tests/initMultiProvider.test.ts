import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runInit } from "../src/cli/init.js";
import { detectAgent } from "../src/utils/agentDetector.js";
import { getSecondaryFiles } from "../src/utils/skillGenerator.js";

describe("Multi-Provider Agent Compliance & Init", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuma-init-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test("antigravity init generates rules, GEMINI.md, skills, and mcp_config", () => {
    const results = runInit({ types: ["antigravity"], projectRoot: tmpDir });

    const generatedFiles = results.map(r => r.filePath);
    expect(generatedFiles).toContain(".kuma/init.md");
    expect(generatedFiles).toContain(".agents/skills/kuma/SKILL.md");
    expect(generatedFiles).toContain(".agents/rules/kuma.md");
    expect(generatedFiles).toContain("GEMINI.md");
    expect(generatedFiles).toContain(".agents/mcp_config.json");

    expect(fs.existsSync(path.join(tmpDir, ".agents/rules/kuma.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "GEMINI.md"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".agents/mcp_config.json"))).toBe(true);

    const ruleContent = fs.readFileSync(path.join(tmpDir, ".agents/rules/kuma.md"), "utf-8");
    expect(ruleContent).toContain("<kuma_obedience>");
    expect(ruleContent).toContain("Matcha & Kuma Harmony");

    const geminiContent = fs.readFileSync(path.join(tmpDir, "GEMINI.md"), "utf-8");
    expect(geminiContent).toContain("Kuma MCP");
    expect(geminiContent).toContain("kuma_context");
  });

  test("opencode init generates AGENTS.md, plugin, and skills", () => {
    const results = runInit({ types: ["opencode"], projectRoot: tmpDir });

    const generatedFiles = results.map(r => r.filePath);
    expect(generatedFiles).toContain("AGENTS.md");
    expect(generatedFiles).toContain(".opencode/plugins/kuma.js");
    expect(generatedFiles).toContain(".agents/skills/kuma/SKILL.md");
    expect(generatedFiles).toContain(".opencode/skills/kuma/SKILL.md");

    expect(fs.existsSync(path.join(tmpDir, ".opencode/plugins/kuma.js"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".opencode/skills/kuma/SKILL.md"))).toBe(true);

    const pluginContent = fs.readFileSync(path.join(tmpDir, ".opencode/plugins/kuma.js"), "utf-8");
    expect(pluginContent).toContain("KumaPlugin");
    expect(pluginContent).toContain("tool.execute.before");

    const agentsContent = fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8");
    expect(agentsContent).toContain("kuma_kuma_context");
    expect(agentsContent).toContain("kuma_context");
  });

  test("claude init generates CLAUDE.md, settings with hooks, and skill", () => {
    const results = runInit({ types: ["claude"], projectRoot: tmpDir });

    const generatedFiles = results.map(r => r.filePath);
    expect(generatedFiles).toContain("CLAUDE.md");
    expect(generatedFiles).toContain(".claude/settings.json");
    expect(generatedFiles).toContain(".claude/skills/kuma/SKILL.md");

    expect(fs.existsSync(path.join(tmpDir, ".claude/settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".claude/skills/kuma/SKILL.md"))).toBe(true);

    const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, ".claude/settings.json"), "utf-8"));
    expect(settings.hooks.PreToolUse.length).toBeGreaterThanOrEqual(2);
  });

  test("agent detector accurately identifies opencode directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".opencode"), { recursive: true });
    const detected = detectAgent(tmpDir);
    expect(detected.detected).toContain("opencode");
    expect(detected.primary).toBe("opencode");
  });

  test("agent detector accurately identifies antigravity directory", () => {
    fs.mkdirSync(path.join(tmpDir, ".agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "GEMINI.md"), "# Antigravity instructions");
    const detected = detectAgent(tmpDir);
    expect(detected.detected).toContain("antigravity");
  });

  test("getSecondaryFiles returns comprehensive files for antigravity and opencode", () => {
    const antigravitySecondary = getSecondaryFiles("antigravity");
    const antigravityPaths = antigravitySecondary.map(s => s.path);
    expect(antigravityPaths).toContain(".agents/mcp_config.json");
    expect(antigravityPaths).toContain(".agents/rules/kuma.md");
    expect(antigravityPaths).toContain("GEMINI.md");

    const opencodeSecondary = getSecondaryFiles("opencode");
    const opencodePaths = opencodeSecondary.map(s => s.path);
    expect(opencodePaths).toContain(".opencode/plugins/kuma.js");
    expect(opencodePaths).toContain(".opencode/skills/kuma/SKILL.md");
    expect(opencodePaths).toContain(".agents/skills/kuma/SKILL.md");
  });
});
