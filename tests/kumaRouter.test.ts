import { jest } from "@jest/globals";

// ============================================================
// IMPORTANT: Use jest.unstable_mockModule for ESM compatibility
// with --experimental-vm-modules (pnpm test).
// jest.mock is NOT hoisted in ESM mode, so static imports
// would bypass the mocks.
//
// jest.unstable_mockModule factories close over local mock refs,
// so they're initialized before await import() runs.
// ============================================================

// kuma_init group
const mockHandleKumaInit = jest.fn<() => Promise<string>>().mockResolvedValue("init done");
jest.unstable_mockModule("../src/tools/kumaInit.js", () => ({ handleKumaInit: mockHandleKumaInit }));
const mockHandleProjectConventions = jest.fn<() => Promise<string>>().mockResolvedValue("conv done");
jest.unstable_mockModule("../src/agents/projectConventions.js", () => ({ handleProjectConventions: mockHandleProjectConventions }));
const mockHandleProjectStructure = jest.fn<() => Promise<string>>().mockResolvedValue("struct done");
jest.unstable_mockModule("../src/tools/projectStructure.js", () => ({ handleProjectStructure: mockHandleProjectStructure }));

// kuma_core group
const mockHandleSmartGrep = jest.fn<() => Promise<string>>().mockResolvedValue("grep done");
jest.unstable_mockModule("../src/tools/smartGrep.js", () => ({ handleSmartGrep: mockHandleSmartGrep }));
const mockHandleSmartFilePicker = jest.fn<() => Promise<string>>().mockResolvedValue("read done");
jest.unstable_mockModule("../src/tools/smartFilePicker.js", () => ({ handleSmartFilePicker: mockHandleSmartFilePicker }));
const mockHandlePreciseDiffEditor = jest.fn<() => Promise<string>>().mockResolvedValue("edit done");
jest.unstable_mockModule("../src/tools/preciseDiffEditor.js", () => ({ handlePreciseDiffEditor: mockHandlePreciseDiffEditor }));
const mockHandleBatchFileWriter = jest.fn<() => Promise<string>>().mockResolvedValue("batch done");
jest.unstable_mockModule("../src/tools/batchFileWriter.js", () => ({ handleBatchFileWriter: mockHandleBatchFileWriter }));
const mockHandleLspQuery = jest.fn<() => Promise<string>>().mockResolvedValue("lsp done");
jest.unstable_mockModule("../src/tools/lspTools.js", () => ({ handleLspQuery: mockHandleLspQuery }));

// kuma_verify group
jest.unstable_mockModule("../src/tools/safeTerminalExec.js", () => ({ handleSafeTerminalExec: jest.fn<() => Promise<string>>().mockResolvedValue("test done") }));
jest.unstable_mockModule("../src/agents/codeReviewer.js", () => ({ handleCodeReviewer: jest.fn<() => Promise<string>>().mockResolvedValue("review done") }));
jest.unstable_mockModule("../src/tools/staticAnalysis.js", () => ({ handleStaticAnalysis: jest.fn<() => Promise<string>>().mockResolvedValue("lint done") }));

// kuma_safety group — local refs for tested functions
const mockHandleKumaGuard = jest.fn<() => Promise<string>>().mockResolvedValue("guard done");
jest.unstable_mockModule("../src/tools/kumaGuard.js", () => ({ handleKumaGuard: mockHandleKumaGuard }));
const mockHandleKumaContext = jest.fn<() => Promise<string>>().mockResolvedValue("context done");
jest.unstable_mockModule("../src/tools/kumaContext.js", () => ({ handleKumaContext: mockHandleKumaContext }));
jest.unstable_mockModule("../src/tools/kumaRisk.js", () => ({ handleKumaRisk: jest.fn<() => Promise<string>>().mockResolvedValue("risk done") }));
jest.unstable_mockModule("../src/tools/kumaDependencyGuard.js", () => ({ handleDependencyGuard: jest.fn<() => Promise<string>>().mockResolvedValue("dep done") }));
jest.unstable_mockModule("../src/tools/kumaPolicy.js", () => ({ handlePolicyCheck: jest.fn<() => Promise<string>>().mockResolvedValue("policy done") }));
jest.unstable_mockModule("../src/engine/safetyScore.js", () => ({
  computeSafetyScore: jest.fn<() => { score: number }>().mockReturnValue({ score: 85 }),
  formatSafetyScore: jest.fn<() => string>().mockReturnValue("score: 85"),
}));
const mockSafetyCheck = jest.fn<() => Promise<string>>().mockResolvedValue("safety done");
jest.unstable_mockModule("../src/engine/kumaSafetyLayer.js", () => ({
  safetyCheck: mockSafetyCheck,
  safetyOverride: jest.fn<() => string>().mockReturnValue("override done"),
}));

// kuma_graph group — local refs for tested functions
jest.unstable_mockModule("../src/engine/kumaGraph.js", () => ({
  queryGraph: jest.fn<() => Promise<string>>().mockResolvedValue("query done"),
  searchGraph: jest.fn<() => Promise<string>>().mockResolvedValue("search done"),
  getGraphStats: jest.fn<() => Promise<string>>().mockResolvedValue("stats done"),
}));
jest.unstable_mockModule("../src/engine/kumaNavigator.js", () => ({ navigate: jest.fn<() => Promise<string>>().mockResolvedValue("nav done") }));
jest.unstable_mockModule("../src/engine/kumaMermaid.js", () => ({ generateDiagram: jest.fn<() => Promise<string>>().mockResolvedValue("diagram done") }));
jest.unstable_mockModule("../src/engine/kumaInvestigator.js", () => ({ investigate: jest.fn<() => Promise<string>>().mockResolvedValue("investigate done") }));
const mockCaptureArchitecture = jest.fn<() => Promise<string>>().mockResolvedValue("captured");
const mockDiffArchitecture = jest.fn<() => Promise<string>>().mockResolvedValue("diffed");
jest.unstable_mockModule("../src/engine/kumaLivingArch.js", () => ({
  captureArchitecture: mockCaptureArchitecture,
  diffArchitecture: mockDiffArchitecture,
  generateLiveArchitectureDiagram: jest.fn<() => Promise<string>>().mockResolvedValue("arch diagram"),
}));
const mockPruneExperiences = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockGetErrorPatterns = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
jest.unstable_mockModule("../src/engine/kumaExperience.js", () => ({
  getExperienceSuggestions: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  getErrorPatterns: mockGetErrorPatterns,
  formatExperienceReport: jest.fn<() => Promise<string>>().mockResolvedValue("exp stats"),
  pruneExperiences: mockPruneExperiences,
}));
const mockSuggestIntentPath = jest.fn<() => Promise<null>>().mockResolvedValue(null);
jest.unstable_mockModule("../src/engine/kumaIntent.js", () => ({
  getIntentPatterns: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  suggestIntentPath: mockSuggestIntentPath,
  formatIntentPatterns: jest.fn<() => string>().mockReturnValue("intent patterns"),
  formatIntentSuggestion: jest.fn<() => string>().mockReturnValue("intent suggestion"),
}));
jest.unstable_mockModule("../src/engine/kumaArchGuard.js", () => ({
  detectArchitecture: jest.fn<() => { name: string }>().mockReturnValue({ name: "clean" }),
  getArchitectureProfile: jest.fn<() => { name: string }>().mockReturnValue({ name: "clean" }),
  scanFilesystemForViolations: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  scanGraphForViolations: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  formatViolations: jest.fn<() => string>().mockReturnValue("violations"),
  formatArchitectureDetection: jest.fn<() => string>().mockReturnValue("arch detected"),
  getArchitectureProfiles: jest.fn<() => any[]>().mockReturnValue([]),
}));

// kuma_memory group — local refs for tested functions
jest.unstable_mockModule("../src/engine/sessionMemory.js", () => ({
  sessionMemory: {
    getToolCallHistory: jest.fn<() => Array<{ toolName: string; params: Record<string, unknown> }>>().mockReturnValue([]),
    getSummary: jest.fn<() => { modifiedFiles: string[]; currentGoal?: string }>().mockReturnValue({ modifiedFiles: [], currentGoal: undefined }),
    recordToolCall: jest.fn(),
  },
  getSessionMemory: jest.fn<() => {}>().mockReturnValue({}),
  handleWriteMemory: jest.fn<() => string>().mockReturnValue("written"),
  searchSessionMemory: jest.fn<() => string>().mockReturnValue("searched"),
}));
jest.unstable_mockModule("../src/engine/kumaMemory.js", () => ({
  recordDecision: jest.fn<() => string>().mockReturnValue("recorded"),
  shouldRecordDecision: jest.fn<() => { worth: boolean }>().mockReturnValue({ worth: false }),
  formatDecisionTemplate: jest.fn<() => string>().mockReturnValue("template"),
}));
jest.unstable_mockModule("../src/engine/kumaContextEngine.js", () => ({
  buildContextForGoal: jest.fn<() => Promise<{ context: any[]; summary: string }>>().mockResolvedValue({ context: [], summary: "" }),
  formatContextItems: jest.fn<() => string>().mockReturnValue("context done"),
}));
const mockDetectStaleNodes = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
const mockAutoHeal = jest.fn<() => Promise<{ healed: number; remaining: number }>>().mockResolvedValue({ healed: 0, remaining: 0 });
jest.unstable_mockModule("../src/engine/kumaSelfHeal.js", () => ({
  detectStaleNodes: mockDetectStaleNodes,
  autoHeal: mockAutoHeal,
  formatHealReport: jest.fn<() => string>().mockReturnValue("heal done"),
}));

// kuma_analytics group — local refs for tested functions
const mockHandleReflect = jest.fn<() => Promise<string>>().mockResolvedValue("reflect done");
jest.unstable_mockModule("../src/tools/kumaReflect.js", () => ({ handleReflect: mockHandleReflect }));
jest.unstable_mockModule("../src/engine/kumaAnalytics.js", () => ({
  computeAnalytics: jest.fn<() => {}>().mockReturnValue({}),
  formatAnalytics: jest.fn<() => string>().mockReturnValue("analytics done"),
}));
jest.unstable_mockModule("../src/engine/kumaHealthDashboard.js", () => ({
  computeHealthDashboard: jest.fn<() => {}>().mockReturnValue({}),
  formatHealthDashboard: jest.fn<() => string>().mockReturnValue("health done"),
}));
jest.unstable_mockModule("../src/engine/kumaReplay.js", () => ({ replaySession: jest.fn<() => string>().mockReturnValue("replay done") }));
jest.unstable_mockModule("../src/engine/kumaHeatMap.js", () => ({
  computeHeatMap: jest.fn<() => Promise<{ entries: any[] }>>().mockResolvedValue({ entries: [] }),
  formatHeatMap: jest.fn<() => string>().mockReturnValue("heatmap done"),
  getSessionActivity: jest.fn<() => Promise<{ totalSessions: number; avgEditsPerSession: number; totalAllEdits: number }>>().mockResolvedValue({ totalSessions: 0, avgEditsPerSession: 0, totalAllEdits: 0 }),
}));
jest.unstable_mockModule("../src/engine/kumaPredict.js", () => ({ predictNext: jest.fn<() => Promise<string>>().mockResolvedValue("predict done") }));
jest.unstable_mockModule("../src/engine/kumaLearning.js", () => ({ learnPatterns: jest.fn<() => Promise<string>>().mockResolvedValue("learn done") }));
jest.unstable_mockModule("../src/engine/kumaConfidence.js", () => ({ computeConfidence: jest.fn<() => Promise<string>>().mockResolvedValue("confidence done") }));
jest.unstable_mockModule("../src/engine/kumaDNA.js", () => ({ generateDNA: jest.fn<() => Promise<string>>().mockResolvedValue("dna done") }));

// kuma_history group
jest.unstable_mockModule("../src/tools/gitLog.js", () => ({ handleGitLog: jest.fn<() => Promise<string>>().mockResolvedValue("log done") }));
jest.unstable_mockModule("../src/tools/gitDiff.js", () => ({ handleGitDiff: jest.fn<() => Promise<string>>().mockResolvedValue("diff done") }));
jest.unstable_mockModule("../src/engine/kumaTimeMachine.js", () => ({
  getSymbolTimeline: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
  formatTimeline: jest.fn<() => string>().mockReturnValue("timeline"),
  getFileHistory: jest.fn<() => any[]>().mockReturnValue([]),
  formatFileHistory: jest.fn<() => string>().mockReturnValue("file history"),
  analyzeCommitMessages: jest.fn<() => { decisions: any[] }>().mockReturnValue({ decisions: [] }),
}));

// kuma_lock group — local refs for tested functions
const mockAcquireLock = jest.fn<() => string>().mockReturnValue("acquired");
const mockListLocks = jest.fn<() => string>().mockReturnValue("locks");
jest.unstable_mockModule("../src/engine/kumaLock.js", () => ({
  acquireLock: mockAcquireLock,
  releaseLock: jest.fn<() => string>().mockReturnValue("released"),
  listLocks: mockListLocks,
  cleanStaleLocks: jest.fn<() => string>().mockReturnValue("cleaned"),
}));

// kuma_advanced group — local refs for tested functions
const mockFailureStats = jest.fn<() => Promise<string>>().mockResolvedValue("failure stats");
jest.unstable_mockModule("../src/engine/kumaFailureKB.js", () => ({
  recordFailure: jest.fn<() => Promise<string>>().mockResolvedValue("failure recorded"),
  queryFailures: jest.fn<() => Promise<string>>().mockResolvedValue("failure query"),
  failureStats: mockFailureStats,
}));
jest.unstable_mockModule("../src/engine/kumaSemantic.js", () => ({ compressGraph: jest.fn<() => Promise<string>>().mockResolvedValue("compress done") }));
const mockSimulateChange = jest.fn<() => Promise<string>>().mockResolvedValue("shadow done");
jest.unstable_mockModule("../src/engine/kumaShadow.js", () => ({ simulateChange: mockSimulateChange }));
jest.unstable_mockModule("../src/engine/kumaCollective.js", () => ({
  discoverCollectivePatterns: jest.fn<() => Promise<string>>().mockResolvedValue("collective done"),
  exportAnonymizedPatterns: jest.fn<() => string>().mockReturnValue("export done"),
  syncCollective: jest.fn<() => Promise<string>>().mockResolvedValue("sync done"),
}));
const mockListMarketplace = jest.fn<() => Promise<string>>().mockResolvedValue("marketplace");
jest.unstable_mockModule("../src/engine/kumaMarketplace.js", () => ({
  listMarketplace: mockListMarketplace,
  installTemplate: jest.fn<() => Promise<string>>().mockResolvedValue("installed"),
}));

// ============================================================
// Dynamic import — works because unstable_mockModule is called
// BEFORE await import() for all dependencies
// ============================================================
const { handleInit, handleCore, handleSafety, handleGraph, handleMemory, handleAnalytics, handleLock, handleAdvanced } = await import("../src/engine/kumaRouter.js");

describe("kumaRouter", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); });

  // ============================================================
  // handleInit — Session initialization
  // ============================================================
  describe("handleInit", () => {
    test("init calls handleKumaInit", async () => {
      const result = await handleInit("init", {});
      expect(mockHandleKumaInit).toHaveBeenCalled();
      expect(result).toBe("init done");
    });
    test("conventions calls handleProjectConventions", async () => {
      await handleInit("conventions", { forceRescan: true });
      expect(mockHandleProjectConventions).toHaveBeenCalledWith({ forceRescan: true });
    });
    test("structure calls handleProjectStructure", async () => {
      await handleInit("structure", { depth: 3 });
      expect(mockHandleProjectStructure).toHaveBeenCalledWith({ depth: 3 });
    });
    test("unknown action returns error", async () => {
      const result = await handleInit("nope", {});
      expect(result).toContain("Unknown action");
    });
  });

  // ============================================================
  // handleCore — Core editing tools
  // ============================================================
  describe("handleCore", () => {
    test("grep calls handleSmartGrep", async () => {
      await handleCore("grep", { query: "test" });
      expect(mockHandleSmartGrep).toHaveBeenCalledWith(
        expect.objectContaining({ query: "test", outputMode: "rich" })
      );
    });
    test("read calls handleSmartFilePicker", async () => {
      await handleCore("read", { filePath: "test.ts" });
      expect(mockHandleSmartFilePicker).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: "test.ts", outputMode: "rich" })
      );
    });
    test("edit calls handlePreciseDiffEditor", async () => {
      await handleCore("edit", { filePath: "test.ts" });
      expect(mockHandlePreciseDiffEditor).toHaveBeenCalled();
    });
    test("batch calls handleBatchFileWriter", async () => {
      await handleCore("batch", { files: [] });
      expect(mockHandleBatchFileWriter).toHaveBeenCalled();
    });
    test("lsp calls handleLspQuery with remapped action param", async () => {
      await handleCore("lsp", { filePath: "test.ts", line: 0, character: 0, lspAction: "refs" });
      expect(mockHandleLspQuery).toHaveBeenCalledWith(
        expect.objectContaining({ action: "refs", filePath: "test.ts" })
      );
    });
  });

  // ============================================================
  // handleSafety — Sub-action param remap verification
  // ============================================================
  describe("handleSafety — param remap", () => {
    test("context calls handleKumaContext with remapped contextAction", async () => {
      await handleSafety("context", { contextAction: "save", goal: "test" });
      expect(mockHandleKumaContext).toHaveBeenCalledWith(
        expect.objectContaining({ action: "save" })
      );
    });
    test("check calls safetyCheck with actionCheck", async () => {
      await handleSafety("check", { actionCheck: "edit", filePath: "x.ts" });
      expect(mockSafetyCheck).toHaveBeenCalledWith("edit", "x.ts", undefined);
    });
    test("guard calls handleKumaGuard", async () => {
      await handleSafety("guard", { goal: "test" });
      expect(mockHandleKumaGuard).toHaveBeenCalled();
    });
  });

  // ============================================================
  // handleGraph — Sub-action routing (the 6 bugs we fixed)
  // ============================================================
  describe("handleGraph — sub-action routing", () => {
    test("arch with archAction=capture calls captureArchitecture", async () => {
      await handleGraph("arch", { archAction: "capture" });
      expect(mockCaptureArchitecture).toHaveBeenCalled();
    });
    test("arch with archAction=diff calls diffArchitecture", async () => {
      await handleGraph("arch", { archAction: "diff" });
      expect(mockDiffArchitecture).toHaveBeenCalled();
    });
    test("experience with experienceAction=prune calls pruneExperiences", async () => {
      await handleGraph("experience", { experienceAction: "prune", keepPerTool: 50 });
      expect(mockPruneExperiences).toHaveBeenCalledWith(50);
    });
    test("experience with experienceAction=errors calls getErrorPatterns", async () => {
      await handleGraph("experience", { experienceAction: "errors", toolName: "smart_grep" });
      expect(mockGetErrorPatterns).toHaveBeenCalledWith("smart_grep", 5);
    });
    test("intent with intentAction=suggest calls suggestIntentPath", async () => {
      await handleGraph("intent", { intentAction: "suggest", intent: "fix login" });
      expect(mockSuggestIntentPath).toHaveBeenCalledWith("fix login");
    });
  });

  // ============================================================
  // handleMemory — Heal sub-action routing
  // ============================================================
  describe("handleMemory — heal routing", () => {
    test("heal with healAction=check calls detectStaleNodes", async () => {
      await handleMemory("heal", { healAction: "check" });
      expect(mockDetectStaleNodes).toHaveBeenCalled();
    });
    test("heal without healAction (default) calls autoHeal", async () => {
      await handleMemory("heal", {});
      expect(mockAutoHeal).toHaveBeenCalled();
    });
  });

  // ============================================================
  // handleAnalytics
  // ============================================================
  describe("handleAnalytics", () => {
    test("reflect calls handleReflect", async () => {
      await handleAnalytics("reflect", { proactive: true });
      expect(mockHandleReflect).toHaveBeenCalledWith({ proactive: true });
    });
    test("unknown action returns error message", async () => {
      const result = await handleAnalytics("nope", {});
      expect(result).toContain("Unknown action");
    });
  });

  // ============================================================
  // handleLock
  // ============================================================
  describe("handleLock", () => {
    test("acquire calls acquireLock with filePath", async () => {
      await handleLock("acquire", { filePath: "test.ts" });
      expect(mockAcquireLock).toHaveBeenCalledWith("test.ts", undefined);
    });
    test("acquire without filePath returns error", async () => {
      const result = await handleLock("acquire", {});
      expect(result).toContain("filePath required");
    });
    test("list calls listLocks", async () => {
      await handleLock("list", {});
      expect(mockListLocks).toHaveBeenCalled();
    });
  });

  // ============================================================
  // handleAdvanced
  // ============================================================
  describe("handleAdvanced", () => {
    test("failure stats calls failureStats", async () => {
      await handleAdvanced("failure", { failureAction: "stats" });
      expect(mockFailureStats).toHaveBeenCalled();
    });
    test("shadow calls simulateChange with shadowType", async () => {
      await handleAdvanced("shadow", { shadowType: "rename", target: "User", newName: "Customer" });
      expect(mockSimulateChange).toHaveBeenCalledWith("rename", "User", "Customer");
    });
    test("marketplace list calls listMarketplace", async () => {
      await handleAdvanced("marketplace", { marketplaceAction: "list" });
      expect(mockListMarketplace).toHaveBeenCalled();
    });
  });
});
