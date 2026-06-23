import fs from "node:fs";
import path from "node:path";

// ============================================================
// SESSION MEMORY — State tracker & Knowledge graph mini proyek
// ============================================================

interface ToolCallRecord {
  toolName: string;
  params: Record<string, unknown>;
  timestamp: number;
}

interface FileModification {
  filePath: string;
  modifiedAt: number;
  status: "modified" | "created" | "failed";
  error?: string;
}

interface TestFailure {
  task: string;
  error: string;
  timestamp: number;
  resolved: boolean;
}

interface SessionState {
  projectRoot: string;
  startTime: number;
  currentGoal: string;
  completedSteps: string[];
  modifiedFiles: Map<string, FileModification>;
  failedFiles: Map<string, TestFailure[]>;
  searchResults: Map<string, string[]>; // query -> file paths
  dependencyGraph: Map<string, string[]>; // file -> depends on
  toolCalls: ToolCallRecord[];
  conventions?: Record<string, unknown>;
}

/** @internal exported for testing */
export class SessionMemory {
  private state!: SessionState;
  private initialized = false;

  init(config: { projectRoot: string; startTime: number }): void {
    const kumaDir = path.join(config.projectRoot, ".kuma");
    const sessionFile = path.join(kumaDir, "session.json");

    if (fs.existsSync(sessionFile)) {
      try {
        const raw = fs.readFileSync(sessionFile, "utf-8");
        const parsed = JSON.parse(raw);
        this.state = {
          projectRoot: parsed.projectRoot || config.projectRoot,
          startTime: parsed.startTime || config.startTime,
          currentGoal: parsed.currentGoal || "",
          completedSteps: parsed.completedSteps || [],
          modifiedFiles: new Map(parsed.modifiedFiles || []),
          failedFiles: new Map(parsed.failedFiles || []),
          searchResults: new Map(parsed.searchResults || []),
          dependencyGraph: new Map(parsed.dependencyGraph || []),
          toolCalls: parsed.toolCalls || [],
          conventions: parsed.conventions,
        };
        this.initialized = true;
        console.error(`[SessionMemory] Loaded persistent session from .kuma/session.json`);
        return;
      } catch (err) {
        console.error(`[SessionMemory] Failed to load persistent session: ${err}. Re-initializing.`);
      }
    }

    this.state = {
      projectRoot: config.projectRoot,
      startTime: config.startTime,
      currentGoal: "",
      completedSteps: [],
      modifiedFiles: new Map(),
      failedFiles: new Map(),
      searchResults: new Map(),
      dependencyGraph: new Map(),
      toolCalls: [],
    };
    this.initialized = true;
    this.save();
    console.error(`[SessionMemory] Initialized at ${new Date(config.startTime).toISOString()}`);
  }

  private save(): void {
    if (!this.initialized || !this.state) return;
    try {
      const kumaDir = path.join(this.state.projectRoot, ".kuma");
      if (!fs.existsSync(kumaDir)) {
        fs.mkdirSync(kumaDir, { recursive: true });
      }
      const serialized = {
        projectRoot: this.state.projectRoot,
        startTime: this.state.startTime,
        currentGoal: this.state.currentGoal,
        completedSteps: this.state.completedSteps,
        modifiedFiles: Array.from(this.state.modifiedFiles.entries()),
        failedFiles: Array.from(this.state.failedFiles.entries()),
        searchResults: Array.from(this.state.searchResults.entries()),
        dependencyGraph: Array.from(this.state.dependencyGraph.entries()),
        toolCalls: this.state.toolCalls,
        conventions: this.state.conventions,
      };
      fs.writeFileSync(path.join(kumaDir, "session.json"), JSON.stringify(serialized, null, 2), "utf-8");
    } catch (err) {
      console.error(`[SessionMemory] Failed to save session: ${err}`);
    }
  }

  setGoal(goal: string): void {
    this.ensureInit();
    this.state.currentGoal = goal;
    this.save();
  }

  addCompletedStep(step: string): void {
    this.ensureInit();
    if (!this.state.completedSteps.includes(step)) {
      this.state.completedSteps.push(step);
      this.save();
    }
  }

  addModifiedFile(filePath: string): void {
    this.ensureInit();
    const existing = this.state.modifiedFiles.get(filePath);
    if (existing) {
      existing.modifiedAt = Date.now();
      existing.status = "modified";
    } else {
      this.state.modifiedFiles.set(filePath, {
        filePath,
        modifiedAt: Date.now(),
        status: "modified",
      });
    }
    this.save();
  }

  addCreatedFile(filePath: string): void {
    this.ensureInit();
    this.state.modifiedFiles.set(filePath, {
      filePath,
      modifiedAt: Date.now(),
      status: "created",
    });
    this.save();
  }

  addFailedFile(task: string, error: string): void {
    this.ensureInit();
    const failures = this.state.failedFiles.get(task) ?? [];
    failures.push({
      task,
      error: error.substring(0, 500),
      timestamp: Date.now(),
      resolved: false,
    });
    this.state.failedFiles.set(task, failures);
    this.save();
  }

  markFailureResolved(task: string): void {
    this.ensureInit();
    const failures = this.state.failedFiles.get(task);
    if (failures) {
      let changed = false;
      for (const f of failures) {
        if (!f.resolved) {
          f.resolved = true;
          changed = true;
        }
      }
      if (changed) {
        this.save();
      }
    }
  }

  addSearchResult(query: string, files: string[]): void {
    this.ensureInit();
    this.state.searchResults.set(query, files);
    this.save();
  }

  addDependency(file: string, dependsOn: string): void {
    this.ensureInit();
    const deps = this.state.dependencyGraph.get(file) ?? [];
    if (!deps.includes(dependsOn)) {
      deps.push(dependsOn);
      this.state.dependencyGraph.set(file, deps);
      this.save();
    }
  }

  recordToolCall(toolName: string, params: Record<string, unknown>): void {
    this.ensureInit();
    this.state.toolCalls.push({
      toolName,
      params,
      timestamp: Date.now(),
    });

    // Keep only last 100 tool calls (prevent memory leak)
    if (this.state.toolCalls.length > 100) {
      this.state.toolCalls = this.state.toolCalls.slice(-100);
    }
    this.save();
  }

  setConventions(conventions: Record<string, unknown>): void {
    this.ensureInit();
    this.state.conventions = conventions;
    this.save();
  }

  pruneMemory(): void {
    this.ensureInit();
    this.state.toolCalls = this.state.toolCalls.slice(-3);
    this.state.searchResults.clear();
    this.state.completedSteps = [];
    this.save();
  }

  getSummary(): Record<string, unknown> {
    this.ensureInit();

    const unresolvedFailures: Array<{ task: string; error: string }> = [];
    for (const [, failures] of this.state.failedFiles) {
      for (const f of failures) {
        if (!f.resolved) {
          unresolvedFailures.push({ task: f.task, error: f.error.substring(0, 200) });
        }
      }
    }

    return {
      projectRoot: this.state.projectRoot,
      sessionDuration: Math.round((Date.now() - this.state.startTime) / 1000) + "s",
      currentGoal: this.state.currentGoal,
      completedSteps: this.state.completedSteps,
      modifiedFiles: Array.from(this.state.modifiedFiles.values()),
      unfailures: unresolvedFailures, // Backward compatibility or simple helper
      unresolvedFailures,
      toolCallCount: this.state.toolCalls.length,
      recentSearches: Array.from(this.state.searchResults.keys()).slice(-5),
      hasConventions: !!this.state.conventions,
    };
  }

  getModifiedFiles(): FileModification[] {
    this.ensureInit();
    return Array.from(this.state.modifiedFiles.values());
  }

  getFailedFiles(): Array<{ task: string; failures: TestFailure[] }> {
    this.ensureInit();
    const result: Array<{ task: string; failures: TestFailure[] }> = [];
    for (const [task, failures] of this.state.failedFiles) {
      result.push({ task, failures });
    }
    return result;
  }

  getToolCallHistory(limit = 10): ToolCallRecord[] {
    this.ensureInit();
    return this.state.toolCalls.slice(-limit);
  }

  detectLoop(): { isLooping: boolean; toolName?: string; message?: string } {
    this.ensureInit();

    const recentCalls = this.state.toolCalls.slice(-10);
    if (recentCalls.length < 6) return { isLooping: false };

    // Check: same tool called >3 times
    const toolCounts = new Map<string, number>();
    for (const call of recentCalls) {
      toolCounts.set(call.toolName, (toolCounts.get(call.toolName) ?? 0) + 1);
    }

    for (const [toolName, count] of toolCounts) {
      if (count >= 4) {
        return {
          isLooping: true,
          toolName,
          message: `Detected potential loop: "${toolName}" called ${count} times in last ${recentCalls.length} tool calls. Consider a different approach.`,
        };
      }
    }

    return { isLooping: false };
  }

  private ensureInit(): void {
    if (!this.initialized) {
      this.init({
        projectRoot: process.cwd(),
        startTime: Date.now(),
      });
    }
  }
}

// Singleton
export const sessionMemory = new SessionMemory();

// Fungsi untuk MCP tool
export function getSessionMemory(): Record<string, unknown> {
  return sessionMemory.getSummary();
}
