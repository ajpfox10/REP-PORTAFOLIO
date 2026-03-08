module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/?(*.)+(spec|test).ts"],
  moduleFileExtensions: ["ts", "js"],
  clearMocks: true,
  moduleNameMapper: {
    // Strip .js extensions for ts-jest (ESM → CJS transform)
    "^(\\.\\.?/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", {
      tsconfig: {
        module: "CommonJS",
        esModuleInterop: true,
      },
    }],
  },
};
