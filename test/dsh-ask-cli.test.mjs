import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const binary = join(projectRoot, 'lib', 'bin', 'dsh-ask.js')
const sourceTemplate = join(projectRoot, 'src', 'templates', 'fish.fish')
const packagedTemplate = join(projectRoot, 'lib', 'templates', 'fish.fish')
const startup = await import('../lib/startup.js')
const askDefaults = await import('../lib/ask-default.js')

/** Run the generated CLI against an isolated shell configuration directory. */
function run(configHome, ...args) {
  return spawnSync(process.execPath, [binary, ...args], {
    cwd: projectRoot,
    env: { ...process.env, XDG_CONFIG_HOME: configHome },
    encoding: 'utf8',
  })
}

test('init fish writes the packaged template and protects user files', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'dsh-ask-init-'))
  const target = join(configHome, 'fish', 'conf.d', 'zz-dsh-ask.fish')
  const template = readFileSync(packagedTemplate, 'utf8')

  try {
    assert.equal(template, readFileSync(sourceTemplate, 'utf8'))

    let result = run(configHome, 'init', 'fish')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(target, 'utf8'), template)

    result = run(configHome, 'init', 'fish')
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(target, 'utf8'), template)

    writeFileSync(target, '# user-managed Fish configuration\n')
    result = run(configHome, 'init', 'fish')
    assert.equal(result.status, 1)
    assert.equal(readFileSync(target, 'utf8'), '# user-managed Fish configuration\n')
  } finally {
    rmSync(configHome, { recursive: true, force: true })
  }
})

test('CLI documents the registered shells and rejects unsupported ones', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'dsh-ask-help-'))

  try {
    let result = run(configHome, '--help')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Usage: dsh-ask init <shell>/)
    assert.match(result.stdout, /fish\s+Install the Fish command-not-found integration/)

    result = run(configHome, 'init', 'sh')
    assert.equal(result.status, 2)
    assert.match(result.stdout, /Supported shells:/)
  } finally {
    rmSync(configHome, { recursive: true, force: true })
  }
})

test('ask startup accepts persisted model and reasoning-effort defaults', () => {
  const program = startup.askCommand()
  program.parse(['node', 'dsh', '--model', 'next-model', '--effort', 'high', 'explain', 'this'])

  assert.deepEqual(program.opts(), { model: 'next-model', effort: 'high' })
  assert.deepEqual(program.args, ['explain', 'this'])
})


test('provider flag accepts a bare listing switch or an explicit provider id', () => {
  const all = startup.askCommand()
  all.parse(['node', 'dsh', '--provider'])
  assert.deepEqual(all.opts(), { provider: true })

  const selected = startup.askCommand()
  selected.parse(['node', 'dsh', '--provider=local'])
  assert.deepEqual(selected.opts(), { provider: 'local' })
})

test('ask defaults are persisted atomically in an independent file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-ask-defaults-'))
  const path = join(directory, 'ask', 'config.json')
  try {
    assert.deepEqual(await askDefaults.loadAskDefaults(path), {})
    const defaults = { lang: 'en', provider: 'deepseek', model: 'next-model', effort: 'high', outputStyle: 'auto', activityStyle: { thinking: ['italic', 'gray'] } }
    await askDefaults.saveAskDefaults(defaults, path)
    assert.deepEqual(await askDefaults.loadAskDefaults(path), defaults)
    assert.deepEqual(askDefaults.loadAskDefaultsSync(path), defaults)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('ask defaults reject unsafe activityStyle values', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-ask-defaults-invalid-'))
  const path = join(directory, 'ask', 'config.json')
  try {
    mkdirSync(join(directory, 'ask'))
    writeFileSync(path, JSON.stringify({ activityStyle: { thinking: ['italic', '\x1b[31m'] } }))
    await assert.rejects(askDefaults.loadAskDefaults(path), /invalid activityStyle token/)
    writeFileSync(path, JSON.stringify({ activityStyle: { other: ['italic'] } }))
    await assert.rejects(askDefaults.loadAskDefaults(path), /invalid activityStyle target/)
    writeFileSync(path, JSON.stringify({ activityStyle: { thinking: [3, 90] } }))
    await assert.rejects(askDefaults.loadAskDefaults(path), /invalid activityStyle token/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})


test('model-only invocation publishes configuration mode without a question', () => {
  let values
  startup.apply({
    get(key) {
      if (key === 'cmdlineArgs') return { get: () => ['--model=next-model'] }
      if (key === 'appExit') return () => {}
      return undefined
    },
    provide(_name, value) { values = value },
  })
  assert.deepEqual(values, {
    task: '', fresh: false, lang: 'zh', saveLanguage: false, listProviders: false, configureOnly: true, model: 'next-model',
  })
})

test('localized help documents all modes in Chinese and English', () => {
  const render = lang => {
    const output = []
    const program = startup.askCommand(lang).configureOutput({ writeOut: text => { output.push(text) } })
    program.outputHelp()
    return output.join('')
  }
  const zh = render('zh')
  assert.match(zh, /显示命令、选项和示例/)
  assert.match(zh, /--lang <zh\|en>/)
  assert.match(zh, /模式：/)
  assert.match(zh, /配置：不提供问题时/)

  const en = render('en')
  assert.match(en, /show commands, options, and examples/)
  assert.match(en, /--lang <zh\|en>/)
  assert.match(en, /Modes:/)
  assert.match(en, /Configure: with no question/)
})

test('provider id without a question publishes configuration instead of listing', () => {
  let values
  startup.apply({
    get(key) {
      if (key === 'cmdlineArgs') return { get: () => ['--provider=deepseek'] }
      if (key === 'appExit') return () => {}
      return undefined
    },
    provide(_name, value) { values = value },
  })
  assert.deepEqual(values, {
    task: '', fresh: false, lang: 'zh', saveLanguage: false, listProviders: false, configureOnly: true, provider: 'deepseek',
  })
})

test('bare provider flag still lists capabilities without saving defaults', () => {
  let values
  startup.apply({
    get(key) {
      if (key === 'cmdlineArgs') return { get: () => ['--provider'] }
      if (key === 'appExit') return () => {}
      return undefined
    },
    provide(_name, value) { values = value },
  })
  assert.deepEqual(values, {
    task: '', fresh: false, lang: 'zh', saveLanguage: false, listProviders: true, configureOnly: false,
  })
})

test('provider id with a question asks through that provider instead of listing', () => {
  let values
  startup.apply({
    get(key) {
      if (key === 'cmdlineArgs') return { get: () => ['--provider=deepseek', 'explain', 'this'] }
      if (key === 'appExit') return () => {}
      return undefined
    },
    provide(_name, value) { values = value },
  })
  assert.deepEqual(values, {
    task: 'explain this', fresh: false, lang: 'zh', saveLanguage: false, listProviders: false, configureOnly: false, provider: 'deepseek',
  })
})

test('startup selects explicit zh/en language and publishes language-only configuration', () => {
  assert.equal(startup.startupLanguage(['--lang=en', '--help']), 'en')
  assert.equal(startup.startupLanguage(['--lang', 'zh']), 'zh')
  let values
  startup.apply({
    get(key) {
      if (key === 'cmdlineArgs') return { get: () => ['--lang=en'] }
      if (key === 'appExit') return () => {}
      return undefined
    },
    provide(_name, value) { values = value },
  })
  assert.deepEqual(values, {
    task: '', fresh: false, lang: 'en', saveLanguage: true, listProviders: false, configureOnly: true,
  })
})
