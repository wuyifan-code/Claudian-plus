const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');

const jestPath = require.resolve('jest/bin/jest');
// Keep each Jest invocation isolated. Node's --localstorage-file persists
// across processes, so a fixed filename makes device-key and settings tests
// depend on whatever a previous run happened to leave behind. An explicit
// override remains useful when debugging a persistence migration.
const localStorageFile = process.env.CLAUDIAN_PLUS_TEST_LOCALSTORAGE
  || process.env.CLAUDIAN_TEST_LOCALSTORAGE
  || path.join(os.tmpdir(), `claudian-plus-localstorage-${process.pid}`);

const result = spawnSync(
  process.execPath,
  [`--localstorage-file=${localStorageFile}`, jestPath, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
