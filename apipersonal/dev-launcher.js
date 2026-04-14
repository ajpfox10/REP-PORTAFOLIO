// dev-launcher.js — lanzador para PM2 en Windows
const { spawn } = require('child_process');
const path = require('path');

const cwd = __dirname;
const child = spawn('npm', ['run', 'dev'], {
  cwd,
  shell: true,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT',  () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
