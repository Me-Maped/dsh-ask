import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const corePackages = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-default-model',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
]

test('declares compatibility with dsh 0.2.2-rc.1 core packages', () => {
  for (const name of corePackages) {
    assert.equal(
      packageJson.peerDependencies[name],
      '0.2.1-rc.5 || 0.2.2-rc.1',
      `${name} must explicitly allow the installed dsh 0.2.2-rc.1 API cohort`,
    )
  }
})
