/** Install the packed plugin in an isolated home and exercise the real dsh runtime.
 * Usage: node scripts/test-runtime.mjs /path/to/dsh/package.json /path/to/plugin.tgz
 * The provider is local and deterministic; no model requests leave this process tree.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [runtimeArgument, archiveArgument] = process.argv.slice(2)
assert.ok(runtimeArgument && archiveArgument, 'Pass the installed dsh package.json and packed plugin tarball')
const runtime = resolve(runtimeArgument)
const archive = resolve(archiveArgument)
const metadata = JSON.parse(readFileSync(runtime, 'utf8'))
assert.equal(metadata.version, '0.2.1-rc.2', 'This smoke suite targets dsh 0.2.1-rc.2')
const binary = resolve(dirname(runtime), typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.dsh)
const home = mkdtempSync(join(tmpdir(), 'dsh-ask-runtime-'))
const profile = join(home, 'profiles', 'ask')
const workdir = join(home, 'workspace')
const requestsPath = join(home, 'requests.jsonl')
const env = {
  ...process.env, DSH_HOME: home, DSH_ASK_STYLE: 'plain', DSH_ASK_SESSION: 'runtime-smoke',
  DSH_ASK_TEST_RUNTIME: runtime, DSH_ASK_TEST_REQUESTS: requestsPath,
  npm_config_registry: 'https://registry.npmjs.org', CI: 'true',
}
const requests = () => {
  try { return readFileSync(requestsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
function run(args, status = 0) {
  console.log(`Checking: dsh ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [binary, ...args], {
    cwd: workdir, env, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
  })
  assert.ifError(result.error)
  assert.equal(result.status, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result
}
const ask = (...args) => run(['--profile', 'ask', ...args])
function files(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)])
}

try {
  mkdirSync(profile, { recursive: true })
  mkdirSync(workdir)
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-ask', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }))
  // A fresh home has no exact-version exemptions. Installation must pass on its own.
  run(['plugin', '--profile', 'ask', 'add', archive])
  assert.match(ask('--help').stdout, /--session/)
  const patch = [
    ...['session-title-llm', 'llm-retry', 'credentials', 'authorization', 'deepseek-account',
      'llm-deepseek', 'llm-deepseek-account'].map(id => ({ id, disabled: true })),
    { id: 'agent-default-model', config: { provider: 'ask-smoke', model: 'smoke' } },
    { insert: [{ id: 'ask-runtime-test-provider', name: fileURLToPath(new URL('../test/fixtures/runtime-provider.mjs', import.meta.url)) }] },
    { id: 'ask-runner', inject: ['askStartup', 'askRuntimeTestReady'] },
  ]
  writeFileSync(join(profile, 'cordis.patch.yml'), JSON.stringify(patch))
  assert.match(ask('--provider').stdout, /ask-smoke/)
  ask('--provider=ask-smoke', '--model=smoke', '--lang=en')
  assert.equal(requests().length, 0, 'help, inspection and configuration must not call the model')
  const first = ask('FIRST')
  assert.equal(first.stdout, 'model=smoke; prompts=FIRST\n')
  assert.match(first.stderr, /Checking persisted history/)
  const second = ask('SECOND')
  assert.equal(second.stdout, 'model=smoke; prompts=FIRST|SECOND\n', 'another process restores durable history')
  assert.match(second.stderr, /resum/i)
  assert.equal(ask('--new', 'FRESH').stdout, 'model=smoke; prompts=FRESH\n')
  assert.equal(ask('--session', 'named', 'NAMED').stdout, 'model=smoke; prompts=NAMED\n')
  assert.equal(ask('--session', 'named', 'AGAIN').stdout, 'model=smoke; prompts=NAMED|AGAIN\n')
  ask('--model=alternate', '--effort=high')
  assert.equal(ask('--new', 'SWITCH').stdout, 'model=alternate; prompts=SWITCH\n')
  assert.equal(requests().at(-1).effort, 'high')
  const failure = run(['--profile', 'ask', '--new', 'FAIL'], 1)
  assert.match(failure.stderr, /SMOKE_FAILURE.*intentional smoke failure/)
  const invalid = run(['--profile', 'ask', '--provider=does-not-exist'], 1)
  assert.match(invalid.stderr, /does-not-exist/)
  const defaults = JSON.parse(readFileSync(join(home, 'ask', 'config.json'), 'utf8'))
  assert.equal(defaults.provider, 'ask-smoke', 'invalid selection must preserve working defaults')
  assert.equal(defaults.model, 'alternate')
  assert.ok(files(join(home, 'sessions')).some(file => /\.jsonl(?:\.zstd)?$/.test(file)), 'real session logs were persisted')
  assert.ok(requests()[0].system.some(message => JSON.stringify(message).includes('coding agent powered by the smoke model')))
  console.log('Runtime smoke passed: install without exemption, help, providers, defaults, streaming, persistence, resume, new/named sessions, model/effort, error exit.')
} finally {
  rmSync(home, { recursive: true, force: true })
}
