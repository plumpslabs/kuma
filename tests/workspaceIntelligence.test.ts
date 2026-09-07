import {
  getWorkspaceInfo,
  findPackageForFile,
  getReverseDependencies,
  getAffectedPackages,
  formatWorkspaceMap,
} from "../src/engine/workspaceIntelligence.js";
import path from "node:path";

describe("Workspace Intelligence (Monorepo & Package Dependencies)", () => {
  it("detects the Kuma repository workspace structure", async () => {
    const wsInfo = await getWorkspaceInfo(process.cwd(), true);
    expect(wsInfo.isWorkspace).toBe(true);
    expect(wsInfo.type).toBe("pnpm");
    expect(wsInfo.packages.length).toBeGreaterThan(1);

    // Root package should exist
    const rootPkg = wsInfo.packages.find((p) => p.isRoot);
    expect(rootPkg).toBeDefined();

    // Studio subpackage should exist
    const studioPkg = wsInfo.packages.find((p) => p.name === "@kuma/studio");
    expect(studioPkg).toBeDefined();
    expect(studioPkg?.path).toContain("studio");
  });

  it("finds the correct owning package for a file", async () => {
    const wsInfo = await getWorkspaceInfo(process.cwd());

    // File inside studio
    const studioFile = "packages/ide/studio/src/index.ts";
    const pkg = findPackageForFile(studioFile, wsInfo);
    expect(pkg).toBeDefined();
    expect(pkg?.name).toBe("@kuma/studio");

    // File in root src
    const rootFile = "src/index.ts";
    const rootPkg = findPackageForFile(rootFile, wsInfo);
    expect(rootPkg).toBeDefined();
    expect(rootPkg?.isRoot).toBe(true);
  });

  it("calculates affected packages when files are modified", async () => {
    const wsInfo = await getWorkspaceInfo(process.cwd());
    const modifiedFiles = ["packages/ide/studio/src/index.ts"];

    const affected = getAffectedPackages(modifiedFiles, wsInfo);
    expect(affected.directlyModifiedPackages.length).toBe(1);
    expect(affected.directlyModifiedPackages[0].name).toBe("@kuma/studio");
    expect(affected.affectedTestCommands.length).toBeGreaterThan(0);
    expect(affected.affectedTestCommands[0]).toContain("@kuma/studio");
  });

  it("formats a clean workspace map string", async () => {
    const wsInfo = await getWorkspaceInfo(process.cwd());
    const map = formatWorkspaceMap(wsInfo);

    expect(map).toContain("Workspace Repository Map");
    expect(map).toContain("@kuma/studio");
  });
});
