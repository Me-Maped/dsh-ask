import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadTerminalReplyPolicy } from '../lib/terminal-reply.js'

async function policyFile(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-ask-reply-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return pathToFileURL(join(directory, 'TERMINAL_REPLY.md'))
}

test('reply policy is reread between asks and preserves literal template syntax', async t => {
  const path = await policyFile(t)
  await writeFile(path, '  First policy: {{literal}}\n')
  assert.equal(await loadTerminalReplyPolicy(path), 'First policy: {{literal}}')
  await writeFile(path, 'Updated policy.\n')
  assert.equal(await loadTerminalReplyPolicy(path), 'Updated policy.')
  await writeFile(path, ' \t\n')
  assert.equal(await loadTerminalReplyPolicy(path), '', 'a blank file disables the policy')
})

test('reply policy read failures identify the file and retain their cause', async t => {
  const path = await policyFile(t)
  for (const code of ['ENOENT', 'EISDIR']) {
    if (code === 'EISDIR') await mkdir(path)
    await assert.rejects(loadTerminalReplyPolicy(path), error => {
      assert.ok(error.message.includes(fileURLToPath(path)))
      assert.equal(error.cause.code, code)
      return true
    })
  }
})
