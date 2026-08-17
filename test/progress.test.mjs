import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgress } from '../lib/progress.js'

test('interactive progress clears its spinner only once', () => {
  const writes = []
  const progress = createProgress({
    isTTY: true,
    write(chunk) {
      writes.push(chunk)
    },
  })

  progress.start('正在思考…')
  progress.stop()

  // Simulate a streamed answer written after the spinner has been removed.
  writes.push('可见回答\n')
  progress.stop()

  assert.deepEqual(writes, [
    '\r\x1b[2K⠋ dsh-ask · 正在思考…',
    '\r\x1b[2K',
    '可见回答\n',
  ])
})
