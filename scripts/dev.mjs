import { spawn } from 'node:child_process';

const shared = ['--env-file=.env', '--watch', '--import', './scripts/process-identity.mjs', '--import', 'tsx'];
const children = [
  spawn(process.execPath, [...shared, 'src/server.ts'], { stdio: 'inherit' }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = exitCode;
}

for (const child of children) {
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`Motify dev service stopped (${signal ?? code ?? 'unknown'}).`);
      stop(code ?? 1);
    }
  });
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
