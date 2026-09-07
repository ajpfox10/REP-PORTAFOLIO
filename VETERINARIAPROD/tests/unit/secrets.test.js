'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('shared secrets resolver', () => {
  let tmpDir;

  beforeEach(() => {
    jest.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-secrets-'));
    delete process.env.INTERNAL_SECRET;
    delete process.env.INTERNAL_SECRET_FILE;
    delete process.env.SECRETS_JSON;
    delete process.env.SECRETS_FILE;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads direct env before file fallback', () => {
    const file = path.join(tmpDir, 'internal_secret.txt');
    fs.writeFileSync(file, 'from-file');
    process.env.INTERNAL_SECRET = 'from-env';
    process.env.INTERNAL_SECRET_FILE = file;

    const { getSecret } = require('../../shared/secrets');
    expect(getSecret('INTERNAL_SECRET')).toBe('from-env');
  });

  test('reads secret from file fallback', () => {
    const file = path.join(tmpDir, 'internal_secret.txt');
    fs.writeFileSync(file, 'from-file\n');
    process.env.INTERNAL_SECRET_FILE = file;

    const { getSecret } = require('../../shared/secrets');
    expect(getSecret('INTERNAL_SECRET')).toBe('from-file');
  });

  test('reads secret from bundle file', () => {
    const bundleFile = path.join(tmpDir, 'bundle.json');
    fs.writeFileSync(bundleFile, JSON.stringify({ INTERNAL_SECRET: 'from-bundle' }));
    process.env.SECRETS_FILE = bundleFile;

    const { getSecret } = require('../../shared/secrets');
    expect(getSecret('INTERNAL_SECRET')).toBe('from-bundle');
  });

  test('preserves multiline secrets when trim is disabled', () => {
    process.env.SECRETS_JSON = JSON.stringify({
      JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nline\n-----END PRIVATE KEY-----\n',
    });

    const { getSecret } = require('../../shared/secrets');
    expect(getSecret('JWT_PRIVATE_KEY', { trim: false }).endsWith('\n')).toBe(true);
  });
});
