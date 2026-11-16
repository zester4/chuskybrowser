// Runs the live test suite on any OS. Sets RUN_LIVE_TESTS=1 for the child Jest process.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [
  '--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--runInBand', '--forceExit', 'tests/live',
], { stdio: 'inherit', env: { ...process.env, RUN_LIVE_TESTS: '1' } });
process.exit(result.status ?? 1);
