import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, internals } from '../lib/index.js'
import { createProgress, formatToolCall } from '../lib/progress.js'
import { saveAskDefaults } from '../lib/ask-default.js'

function capture(isTTY = false) {
  const writes = []
  return {
    writes,
    stream: {
      ...(isTTY ? { isTTY: true } : {}),
      write(chunk) {
        writes.push(chunk)
      },
    },
  }
}

test('interactive progress clears its spinner only once', () => {
  const { writes, stream } = capture(true)
  const progress = createProgress(stream)

  progress.start('正在思考…')
  progress.stop()

  // Simulate a streamed answer written after the spinner has been removed.
  writes.push('可见回答\n')
  progress.stop()

  assert.deepEqual(writes, [
    '\r\x1b[2K\x1b[2;90m⠋ dsh-ask · 正在思考…\x1b[0m',
    '\r\x1b[2K',
    '可见回答\n',
  ])
})

test('interactive thinking and operations have distinct native terminal styles', () => {
  const { writes, stream } = capture(true)
  const progress = createProgress(stream)

  progress.start('正在思考…')
  progress.appendThinking('检查事件流\n')
  progress.operation(formatToolCall('bash', '{"command":"git status --short"}'))
  progress.stop()

  const output = writes.join('')
  assert.match(output, /\x1b\[2;3;90m  思考 · 检查事件流\x1b\[0m\n/)
  assert.match(output, /\x1b\[1;36m▶ 执行 · bash \$ git status --short\x1b\[0m\n/)
  assert.ok(output.indexOf('思考 · 检查事件流') < output.indexOf('▶ 执行 · bash'))
})

test('activity can request a line boundary before a later answer-side operation', () => {
  const { writes, stream } = capture(true)
  const progress = createProgress(stream, { beforeActivity: () => { writes.push('\n') } })

  progress.start('正在思考…')
  progress.stop()
  progress.operation('bash $ git status --short')

  assert.deepEqual(writes.slice(-2), [
    '\n',
    '\x1b[1;36m▶ 执行 · bash $ git status --short\x1b[0m\n',
  ])
})


test('non-interactive progress keeps activity readable without terminal controls', () => {
  const { writes, stream } = capture()
  const progress = createProgress(stream)

  progress.start('正在准备持久会话…')
  progress.update('正在思考…')
  progress.appendThinking('检查')
  progress.appendThinking('仓库\n')
  progress.operation(formatToolCall('read', '{"file_path":"src/index.ts"}'))
  progress.stop()

  assert.deepEqual(writes, [
    'dsh-ask · 正在准备持久会话…\n',
    'dsh-ask · 正在思考…\n',
    '  思考 · 检查仓库\n',
    '▶ 执行 · read src/index.ts\n',
  ])
  assert.doesNotMatch(writes.join(''), /\x1b|\r/)
})

test('plain preset avoids ANSI styling, cursor control, and spinner animation on a TTY', () => {
  const { writes, stream } = capture(true)
  const progress = createProgress(stream, { style: 'plain' })

  progress.start('正在思考…')
  progress.appendThinking('检查兼容性\n')
  progress.operation('bash $ git status --short')
  progress.stop()

  assert.deepEqual(writes, [
    'dsh-ask · 正在思考…\n',
    '  思考 · 检查兼容性\n',
    '▶ 执行 · bash $ git status --short\n',
  ])
})

test('subtle and contrast presets select their documented ANSI emphasis', () => {
  const subtle = capture(true)
  const subtleProgress = createProgress(subtle.stream, { style: 'subtle' })
  subtleProgress.start('正在思考…')
  subtleProgress.appendThinking('检查事件流\n')
  subtleProgress.operation('bash $ git status --short')
  subtleProgress.stop()
  assert.match(subtle.writes.join(''), /\x1b\[2m  思考 · 检查事件流\x1b\[0m\n/)
  assert.match(subtle.writes.join(''), /\x1b\[1m▶ 执行 · bash \$ git status --short\x1b\[0m\n/)

  const contrast = capture(true)
  const contrastProgress = createProgress(contrast.stream, { style: 'contrast' })
  contrastProgress.start('正在思考…')
  contrastProgress.operation('bash $ git status --short')
  contrastProgress.stop()
  assert.match(contrast.writes.join(''), /\x1b\[1;93m▶ 执行 · bash \$ git status --short\x1b\[0m\n/)
})


test('tool-call previews are compact, sanitized, and tolerate malformed JSON', () => {
  assert.equal(
    formatToolCall('bash', '{"command":"git status\\n--short"}'),
    'bash $ git status --short',
  )
  assert.equal(
    formatToolCall('grep', '{"pattern":"SessionEvent","path":"src"}'),
    'grep SessionEvent · src',
  )
  assert.equal(formatToolCall('bash', '{"command":'), 'bash')
  assert.equal(
    formatToolCall('\x1b[31mread\u202E', '{"file_path":"src/\\u001b[2K\\u200Bindex.ts"}'),
    '[31mread src/[2Kindex.ts',
  )
  const longSearch = formatToolCall('grep', JSON.stringify({
    pattern: 'p'.repeat(180),
    path: 'x'.repeat(180),
  }))
  assert.ok(longSearch.length <= 180)
})


test('NO_COLOR leaves interactive activity readable without SGR styles', { concurrency: false }, () => {
  const prior = process.env.NO_COLOR
  process.env.NO_COLOR = '1'
  try {
    const { writes, stream } = capture(true)
    const progress = createProgress(stream)
    progress.start('正在思考…')
    progress.operation('bash $ git status --short')
    progress.stop()
    assert.doesNotMatch(writes.join(''), /\x1b\[[0-9;]*m/)
    assert.match(writes.join(''), /▶ 执行 · bash \$ git status --short/)
  } finally {
    if (prior === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = prior
  }
})


test('runner emits later thinking and tool rows on a separate TTY line', { timeout: 1_000 }, async () => {
  const stdout = []
  const stderr = []
  const previousStdout = internals.stdout
  const previousStderr = internals.stderr
  internals.stdout = { isTTY: true, write(chunk) { stdout.push(chunk) } }
  internals.stderr = { isTTY: true, write(chunk) { stderr.push(chunk) } }

  const listeners = new Map()
  const session = { seq: 0, events: [] }
  let sequence = 0
  const emit = (type, data) => {
    const event = { type, seq: ++sequence, time: Date.now(), data }
    session.seq = event.seq
    session.events.push(event)
    for (const listener of listeners.get('session/event') ?? []) listener(session, event)
  }
  let finish
  const exited = new Promise(resolve => { finish = resolve })
  const agent = {
    session,
    async whenIdle() {},
    followup() {
      for (const listener of listeners.get('agent/status') ?? []) listener({ agent, status: 'running' })
      emit('turn/start', { turn: 1 })
      emit('step/start', { turn: 1, step: 1 })
      emit('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Draft' } })
      emit('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 1, text: 'Checking again\n' } })
      emit('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"git status --short"}' })
      emit('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 2, text: ' complete' } })
      emit('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Draft complete' }] } })
      emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
    },
  }
  const ctx = {
    get(key) {
      if (key === 'appExit') return finish
      if (key === 'loader') return { await: async () => {} }
      if (key === 'agents') return {
        async resume({ resumeSessionId }) { throw new Error(`session "${resumeSessionId}" not found`) },
        async create() { return { agent } },
      }
      if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'test' }) }
      if (key === 'llm') return { async resolveCallConfig(selection) { return selection } }
      if (key === 'sessions') return { async flush() {} }
      return undefined
    },
    on(name, listener) {
      const group = listeners.get(name) ?? []
      group.push(listener)
      listeners.set(name, group)
      return () => listeners.set(name, group.filter(candidate => candidate !== listener))
    },
  }

  try {
    apply(ctx, { task: 'test', fresh: false, explicitSession: 'stream-test', outputStyle: 'contrast' })
    assert.equal(await exited, 0)
    assert.deepEqual(stdout, ['Draft', ' complete', '\n'])
    const activity = stderr.join('')
    assert.match(activity, /\n\x1b\[2;90m  思考 · Checking again\x1b\[0m\n/)
    assert.match(activity, /\x1b\[1;93m▶ 执行 · bash \$ git status --short\x1b\[0m\n/)
    assert.ok(activity.indexOf('思考 · Checking again') < activity.indexOf('▶ 执行 · bash'))
  } finally {
    internals.stdout = previousStdout
    internals.stderr = previousStderr
  }
})

test('progress accepts English activity labels without changing terminal rendering', () => {
  const { writes, stream } = capture()
  const progress = createProgress(stream, { labels: { thought: 'Thought', operation: 'Run' } })
  progress.start('Thinking…')
  progress.appendThinking('Checking repository\n')
  progress.operation('bash $ git status --short')
  progress.stop()

  assert.deepEqual(writes, [
    'dsh-ask · Thinking…\n',
    '  Thought · Checking repository\n',
    '▶ Run · bash $ git status --short\n',
  ])
})

test('runner localizes configuration-only and provider inspection output', { concurrency: false }, async () => {
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'dsh-ask-runner-i18n-'))
  const previousStdout = internals.stdout
  const previousStderr = internals.stderr
  const stdout = []
  const stderr = []
  internals.stdout = { write(chunk) { stdout.push(chunk) } }
  internals.stderr = { write(chunk) { stderr.push(chunk) } }
  process.env.DSH_HOME = home

  const invoke = async config => {
    let finish
    const exited = new Promise(resolve => { finish = resolve })
    const ctx = {
      get(key) {
        if (key === 'appExit') return finish
        if (key === 'loader') return { await: async () => {} }
        if (key === 'agents') return {}
        if (key === 'sessions') return {}
        if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test', model: 'base' }) }
        if (key === 'llm') return {
          async resolveCallConfig(selection) { return selection },
          listProviders: () => [{ id: 'test', name: 'Test Provider' }],
          async listModels() { return [{ id: 'model-a', name: 'Model A' }] },
          async resolveModelInfo() { return { reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } } },
        }
        return undefined
      },
      on() { return () => {} },
    }
    apply(ctx, config)
    await exited
  }

  try {
    await invoke({ task: '', fresh: false, outputStyle: 'plain', lang: 'en', saveLanguage: true, model: 'model-a', listProviders: false, configureOnly: true })
    assert.deepEqual(stdout.splice(0), [
      'dsh-ask: default configuration saved\nLanguage: English (en)\nProvider: test\nModel: model-a\nReasoning effort: provider default\n',
    ])
    await invoke({ task: '', fresh: false, outputStyle: 'plain', lang: 'en', saveLanguage: false, listProviders: true, configureOnly: false })
    assert.deepEqual(stdout.splice(0), [
      'provider test (Test Provider)\n',
      '  model model-a (Model A)\n',
      '    effort high [default] (High)\n',
    ])
  } finally {
    internals.stdout = previousStdout
    internals.stderr = previousStderr
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})

test('runner saves an explicit provider and does not keep another provider\'s model', { concurrency: false }, async () => {
  const previousHome = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'dsh-ask-runner-provider-'))
  const previousStdout = internals.stdout
  const previousStderr = internals.stderr
  internals.stdout = { write() {} }
  internals.stderr = { write() {} }
  process.env.DSH_HOME = home
  const selections = []

  const invoke = async config => {
    let finish
    const exited = new Promise(resolve => { finish = resolve })
    const ctx = {
      get(key) {
        if (key === 'appExit') return finish
        if (key === 'loader') return { await: async () => {} }
        if (key === 'agents') return {}
        if (key === 'sessions') return {}
        if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'openai', model: 'gpt-4' }) }
        if (key === 'llm') return {
          async resolveCallConfig(selection) {
            selections.push(selection)
            return selection
          },
          listProviders: () => [
            { id: 'openai', name: 'OpenAI' },
            { id: 'deepseek', name: 'DeepSeek' },
          ],
          async listModels(provider) {
            return provider === 'deepseek'
              ? [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }]
              : [{ id: 'gpt-4', name: 'GPT-4' }]
          },
          async resolveModelInfo() { return {} },
        }
        return undefined
      },
      on() { return () => {} },
    }
    apply(ctx, config)
    await exited
  }

  try {
    await saveAskDefaults({ model: 'gpt-4' })
    await invoke({
      task: '', fresh: false, outputStyle: 'plain', lang: 'zh', saveLanguage: false,
      provider: 'deepseek', listProviders: false, configureOnly: true,
    })
    assert.deepEqual(selections.at(-1), { provider: 'deepseek', model: 'deepseek-chat' })
    const saved = JSON.parse(readFileSync(join(home, 'ask', 'config.json'), 'utf8'))
    assert.equal(saved.provider, 'deepseek')
    assert.notEqual(saved.model, 'gpt-4')
    selections.length = 0
    await invoke({ task: '', fresh: false, outputStyle: 'plain', lang: 'zh', saveLanguage: true, listProviders: false, configureOnly: true })
    assert.equal(selections.at(-1)?.provider, 'deepseek')
  } finally {
    internals.stdout = previousStdout
    internals.stderr = previousStderr
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
