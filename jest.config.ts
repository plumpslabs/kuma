import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "tsconfig.json",
      },
    ],
  },
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  verbose: true,
  collectCoverage: true,
  collectCoverageFrom: [
    "src/tools/smartGrep.ts",
    "src/tools/preciseDiffEditor.ts",
    "src/engine/sessionMemory.ts",
  ],
  coverageReporters: ["text", "lcov"],
};

export default config;
