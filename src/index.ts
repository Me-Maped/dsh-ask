/**
 * @dsh-local/dsh-ask — terminal-scoped one-shot questions over dsh-base.
 * Each invocation streams visible assistant text, persists the durable session,
 * and then requests launcher-managed process exit.
 *
 * @module @dsh-local/dsh-ask
 */

import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createProgress, formatToolCall, type OutputStyle, type StatusStream } from './progress.js'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'ask-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin configuration resolved from the startup service. */
export interface Config {
  /** Prompt text for this run. */
  task: string
  /** Create a new persisted conversation instead of using the terminal default. */
  fresh: boolean
  /** Explicit persisted conversation to resume. */
  explicitSession?: string
  /** Native-terminal presentation preset. */
  outputStyle: OutputStyle
}

/** Runtime validator for {@link Config}. */
export const Config: z<Config> = z.object({
  task: z.string().required(),
  fresh: z.boolean().default(false),
  explicitSession: z.string(),
  outputStyle: z.union(['auto', 'plain', 'subtle', 'contrast']).default('auto'),
})

/** Outcome of the turn interval owned by this invocation. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/** Narrow writable stream interface used by this command. */
interface OutputStream {
  write(chunk: string): unknown
  isTTY?: boolean
}

/** Process-facing effects of one run. */
interface AskIo {
  stdout: OutputStream
  stderr: StatusStream
  /** Request shutdown after the Cordis tree disposes. */
  exit(code: number): void
}

/** The process streams the runner writes to; tests can replace these captures. */
export const internals: { stdout: OutputStream; stderr: StatusStream } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the final assistant text and terminal reason in one turn interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: RunOutcome['reason']
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Convert one durable event into a truthful terminal lifecycle label. */
function activityFor(event: SessionEvent): string | undefined {
  switch (event.type) {
    case 'turn/start': return '正在思考…'
    case 'step/start': return '正在分析问题…'
    case 'assistant/chunk': return event.data.chunk.type === 'text-delta' ? '正在生成回答…' : undefined
    case 'tool/call': return `正在调用工具：${event.data.name}`
    case 'tool/result': return '正在整理工具结果…'
    default: return undefined
  }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: AskIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/** Whether a rejected resume means that the persisted session does not exist yet. */
function isSessionMissing(error: unknown): boolean {
  return error instanceof Error && /session ".*" not found/.test(error.message)
}

/** Derive the durable default conversation identity from directory and parent shell. */
function defaultSessionId(cwd: string): SessionId {
  const terminal = process.env.DSH_ASK_SESSION ?? String(process.ppid)
  const digest = createHash('sha256').update(`${cwd}\u0000${terminal}`).digest('hex').slice(0, 16)
  return SessionId(`ask-${digest}`)
}

/** Create or resume the selected session, run one question, persist it, and exit. */
async function run(ctx: Context, config: Config, io: AskIo): Promise<void> {
  let stopEvents: (() => void) | undefined
  let streamedText = false
  let streamEndsWithNewline = false
  let terminalAnswerLineOpen = false
  const progress = createProgress(io.stderr, {
    style: config.outputStyle,
    beforeActivity: () => {
      if (!terminalAnswerLineOpen || io.stdout.isTTY !== true || io.stderr.isTTY !== true) return
      io.stderr.write('\n')
      terminalAnswerLineOpen = false
    },
  })
  progress.start('正在准备持久会话…')
  try {
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    const sessions = ctx.get('sessions')
    if (agents === undefined || defaultModel === undefined || sessions === undefined) return

    const cwd = process.cwd()
    const sessionId = config.explicitSession !== undefined
      ? SessionId(config.explicitSession)
      : config.fresh
        ? SessionId(`ask-${randomUUID()}`)
        : defaultSessionId(cwd)
    const selection = defaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    }

    let handle
    let resumed = true
    progress.update('正在恢复持久会话…')
    try {
      handle = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    } catch (error: unknown) {
      if (!isSessionMissing(error)) throw error
      resumed = false
      progress.update('正在创建持久会话…')
      handle = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
    }
    await handle.agent.whenIdle()
    progress.update(`${resumed ? '已恢复' : '已创建'}会话 ${sessionId}`)

    const stopAgentStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== handle.agent || status !== 'running' || streamedText) return
      progress.update('正在思考…')
    }, { global: true })
    const reasoningChunks = new Set<string>()
    const stopSessionEvents = ctx.on('session/event', (subject, event) => {
      if (subject !== handle.agent.session) return
      if (event.type === 'assistant/chunk') {
        const chunk = event.data.chunk
        if (chunk.type === 'text-delta') {
          const text = chunk.text
          if (text === '') return
          if (!streamedText) {
            streamedText = true
            progress.flushThinking()
            progress.stop()
          }
          io.stdout.write(text)
          streamEndsWithNewline = text.endsWith('\n')
          terminalAnswerLineOpen = !streamEndsWithNewline
          return
        }
        if (chunk.type === 'reasoning-delta') {
          if (chunk.text !== '') {
            reasoningChunks.add(`${event.data.turn}:${event.data.step}:${chunk.index}`)
            progress.appendThinking(chunk.text)
          }
          return
        }
        if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') {
          if (!reasoningChunks.delete(`${event.data.turn}:${event.data.step}:${chunk.index}`) && chunk.block.text !== '') {
            progress.appendThinking(chunk.block.text)
          }
          progress.flushThinking()
          return
        }
      }
      if (event.type === 'tool/call') {
        progress.flushThinking()
        progress.operation(formatToolCall(event.data.name, event.data.arguments))
      }
      if (event.type === 'step/end' || event.type === 'turn/end') progress.flushThinking()
      const activity = activityFor(event)
      if (activity !== undefined) progress.update(activity)
    }, { global: true })
    stopEvents = (): void => {
      stopAgentStatus()
      stopSessionEvents()
    }

    const firstSeq = handle.agent.session.seq
    progress.update('正在思考…')
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    progress.flushThinking()
    if (!streamedText) progress.update('正在保存会话历史…')
    await sessions.flush(handle.agent.session)
    const outcome = summarize(handle.agent.session.events, firstSeq)
    progress.stop()
    if (streamedText) {
      if (!streamEndsWithNewline) io.stdout.write('\n')
    } else {
      io.stdout.write(outcome.text + '\n')
    }
    if (outcome.reason?.kind === 'error') {
      io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
    }
    io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
  } finally {
    stopEvents?.()
    progress.flushThinking()
    progress.stop()
  }
}

/** Mount the terminal one-shot runner. */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('ask-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: AskIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
