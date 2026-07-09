import { jest } from "@jest/globals";
import type { Mock } from "jest-mock";

// Use jest.mock (hoisted) instead of jest.unstable_mockModule (not hoisted)
jest.mock("../src/utils/pathValidator.js", () => ({
  getProjectRoot: jest.fn<any>().mockReturnValue("/tmp/kuma-test"),
}));

import {
  acquireLock,
  releaseLock,
  listLocks,
  cleanStaleLocks,
  isLocked,
} from "../src/engine/kumaLock.js";
import fs from "node:fs";

describe("kumaLock", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(fs, "mkdirSync").mockImplementation(() => "");
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    jest.spyOn(fs, "readFileSync").mockReturnValue(
      JSON.stringify({
        filePath: "test.ts",
        agentId: `agent-${process.pid}`,
        acquiredAt: Date.now(),
        status: "locked",
      }),
    );
    jest.spyOn(fs, "unlinkSync").mockImplementation(() => {});
    jest.spyOn(fs, "readdirSync").mockReturnValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("acquireLock", () => {
    test("acquires lock when file not locked", () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      const r = acquireLock("test.ts");
      expect(r).toContain("Lock acquired");
    });
    test("returns already locked when same agent", () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      const r = acquireLock("test.ts");
      expect(r).toContain("Already locked");
    });
    test("detects another agent's lock", () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({
          filePath: "test.ts",
          agentId: "other-agent",
          acquiredAt: Date.now(),
          status: "locked",
        }),
      );
      const r = acquireLock("test.ts");
      expect(r).toContain("**Locked** by");
      expect(r).toContain("other-agent");
    });
  });

  describe("releaseLock", () => {
    test("same agent releases", () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      const r = releaseLock("test.ts");
      expect(r).toContain("Lock released");
    });
    test("different agent blocked", () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({
          filePath: "test.ts",
          agentId: "other-agent",
          acquiredAt: Date.now(),
          status: "locked",
        }),
      );
      const r = releaseLock("test.ts");
      expect(r).toContain("Cannot release");
    });
    test("no lock warning", () => {
      const r = releaseLock("test.ts");
      expect(r).toContain("No lock found");
    });
  });

  describe("listLocks", () => {
    test("no locks", () => {
      (fs.readdirSync as Mock).mockReturnValue([]);
      expect(listLocks()).toContain("No active locks");
    });
    test("lists active locks", () => {
      (fs.readdirSync as Mock).mockReturnValue(["test.ts.lock.json"]);
      expect(listLocks()).toContain("Active Locks");
    });
  });

  describe("isLocked", () => {
    test("not locked", () => {
      expect(isLocked("test.ts").locked).toBe(false);
    });
    test("locked", () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      expect(isLocked("test.ts").locked).toBe(true);
    });
  });
});
