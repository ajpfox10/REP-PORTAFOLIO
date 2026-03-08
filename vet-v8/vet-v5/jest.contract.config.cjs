module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.contract.test.ts"],
  moduleFileExtensions: ["ts", "js"],
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/src/tests/contract/setupOpenApi.ts"]
};
