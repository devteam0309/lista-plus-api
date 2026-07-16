export default {
  testEnvironment: 'node',
  // ESM: no transform, run via NODE_OPTIONS=--experimental-vm-modules (see package.json).
  transform: {},
  setupFiles: ['<rootDir>/tests/env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // mongodb-memory-server downloads a binary on first run.
  testTimeout: 60000,
  clearMocks: true,
};
