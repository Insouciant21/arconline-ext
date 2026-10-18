import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { configPath, projectRoot, readConfig, requireDatabase } from './lib/deployment-config.mjs';

const { values } = parseArgs({ options: {
  config: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
} });
const selected = values.config
  ? configPath({ ARCAEA_CONFIG: values.config })
  : configPath();
const source = readConfig(selected);
if (!values['dry-run']) requireDatabase(source);
const env = { ...process.env, ARCAEA_CONFIG: selected };
delete env.ARCAEA_CONFIG_JSON;

function run(args) {
  const result = spawnSync('pnpm', args, { cwd: projectRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Deployment config: ${selected}`);
// Always rebuild with this source config; never deploy a previous target's output.
run(['build']);
const output = resolve(projectRoot, 'dist/server/wrangler.json');
const built = readConfig(output);
if (resolve(built.userConfigPath || '') !== selected) {
  throw new Error('Build output does not match the selected Wrangler config');
}
if (!values['dry-run']) {
  run(['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', output]);
}
run(['exec', 'wrangler', 'deploy', '--config', output, ...(values['dry-run'] ? ['--dry-run'] : [])]);
