import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const binary = join(projectRoot, 'lib', 'bin', 'dsh-ask.js')
const sourceTemplate = join(projectRoot, 'src', 'templates', 'fish.fish')
const packagedTemplate = join(projectRoot, 'lib', 'templates', 'fish.fish')

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
