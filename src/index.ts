/**
 * @dsh-local/dsh-ask — terminal-scoped one-shot questions over dsh-base.
 * Each invocation streams visible assistant text, persists the durable session,
 * and then requests launcher-managed process exit.
 *
 * @module @dsh-local/dsh-ask
 */

import { createHash, randomUUID } from 'node:crypto'
import { loadAskDefaults, saveAskDefaults } from './ask-default.js'
import { messagesFor, type AskLanguage, type AskMessages } from './i18n.js'
import type { Context } from '@deepseek-ai/cordis'
import { createProgress, formatToolCall, type OutputStyle, type StatusStream } from './progress.js'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'ask-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions', 'llm']

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
  /** Output language selected for this invocation. */
  lang: AskLanguage
  /** Whether this invocation explicitly changes the persisted language. */
  saveLanguage: boolean
  /** Model id within the configured default provider for this invocation. */
  model?: string
  /** Adapter-owned reasoning-effort id saved as the ask default. */
  effort?: string
  /** Print registered providers and model capabilities instead of asking. */
  listProviders: boolean
  /** Optional registered provider id used to filter the capability list. */
  provider?: string
  /** Change defaults and print their effective value without starting a chat. */
  configureOnly: boolean
}

/** Runtime validator for {@link Config}. */
export const Config: z<Config> = z.object({
  task: z.string().required(),
  fresh: z.boolean().default(false),
  explicitSession: z.string(),
  outputStyle: z.union(['auto', 'plain', 'subtle', 'contrast']).default('auto'),
  lang: z.union(['zh', 'en']).default('zh'),
  saveLanguage: z.boolean().default(false),
  model: z.string(),
  effort: z.string(),
  listProviders: z.boolean().default(false),
  provider: z.string(),
  configureOnly: z.boolean().default(false),
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
function activityFor(event: SessionEvent, text: AskMessages): string | undefined {
  switch (event.type) {
    case 'turn/start': return text.progress.thinking
    case 'step/start': return text.progress.analyzing
    case 'assistant/chunk': return event.data.chunk.type === 'text-delta' ? text.progress.generating : undefined
    case 'tool/call': return text.progress.callingTool(event.data.name)
    case 'tool/result': return text.progress.organizingToolResult
    default: return undefined
  }
}

/** Request exit only after the launcher has completed profile boot. */
function exitAfterReady(ctx: Context, io: AskIo, code: number): void {
  const ready = ctx.get('appReady')
  if (ready === undefined) {
    io.exit(code)
    return
  }
  ready.onReady(() => { io.exit(code) })
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

/** Print registered provider capabilities in a script- and terminal-friendly form. */
async function printProviders(llm: LlmRuntime, providerFilter: string | undefined, stdout: OutputStream, text: AskMessages): Promise<void> {
  const providers = llm.listProviders()
    .filter(provider => providerFilter === undefined || provider.id === providerFilter)
  if (providers.length === 0) {
    throw new Error(providerFilter === undefined ? text.provider.none : text.provider.unknown(providerFilter))
  }
  for (const provider of providers) {
    stdout.write(`${text.provider.provider(provider.id, provider.name)}\n`)
    const models = await llm.listModels(provider.id)
    if (models.length === 0) {
      stdout.write(`${text.provider.noModels}\n`)
      continue
    }
    for (const model of models) {
      stdout.write(`${text.provider.model(model.id, model.name)}\n`)
      const resolved = await llm.resolveModelInfo(provider.id, model.id)
      const reasoning = resolved.reasoning
      if (reasoning === undefined || reasoning.efforts.length === 0) {
        stdout.write(`${text.provider.effortUnavailable}\n`)
        continue
      }
      for (const effort of reasoning.efforts) {
        stdout.write(`${text.provider.effort(effort.id, effort.name, effort.id === reasoning.defaultEffort)}\n`)
      }
    }
  }
}

/** Create or resume the selected session, run one question, persist it, and exit. */
async function run(ctx: Context, config: Config, io: AskIo): Promise<void> {
  let stopEvents: (() => void) | undefined
  let streamedText = false
  let streamEndsWithNewline = false
  let terminalAnswerLineOpen = false
  const text = messagesFor(config.lang)
  const progress = createProgress(io.stderr, {
    style: config.outputStyle,
    labels: { thought: text.progress.thought, operation: text.progress.operation },
    beforeActivity: () => {
      if (!terminalAnswerLineOpen || io.stdout.isTTY !== true || io.stderr.isTTY !== true) return
      io.stderr.write('\n')
      terminalAnswerLineOpen = false
    },
  })
  progress.start(text.progress.preparingSession)
  try {
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    const sessions = ctx.get('sessions')
    const llm = ctx.get('llm')
    if (llm === undefined || agents === undefined || defaultModel === undefined || sessions === undefined) return
    if (config.listProviders) {
      progress.stop()
      await printProviders(llm, config.provider, io.stdout, text)
      exitAfterReady(ctx, io, 0)
      return
    }

    const cwd = process.cwd()
    const sessionId = config.explicitSession !== undefined
      ? SessionId(config.explicitSession)
      : config.fresh
        ? SessionId(`ask-${randomUUID()}`)
        : defaultSessionId(cwd)
    const defaultSelection = defaultModel.currentSelection()
    const savedDefaults = await loadAskDefaults()
    // --model/--effort change only dsh-ask's persisted defaults. A new model
    // clears the old effort unless an effort is supplied in the same command,
    // because effort identifiers are model-specific.
    const selectedDefaultModel = config.model ?? savedDefaults.model
    const nextDefaults = {
      lang: config.lang,
      ...(selectedDefaultModel === undefined ? {} : { model: selectedDefaultModel }),
      ...(config.effort !== undefined
        ? { effort: config.effort }
        : config.model === undefined && savedDefaults.effort !== undefined
          ? { effort: savedDefaults.effort }
          : {}),
    }
    const selectedEffort = config.effort !== undefined
      ? ReasoningEffortId(config.effort)
      : config.model === undefined
        ? nextDefaults.effort === undefined
          ? defaultSelection.reasoningEffort
          : ReasoningEffortId(nextDefaults.effort)
        : undefined
    const selection = {
      provider: defaultSelection.provider,
      model: nextDefaults.model ?? defaultSelection.model,
      ...(selectedEffort === undefined ? {} : { reasoningEffort: selectedEffort }),
    }
    // Validate before persisting so a typo or an unsupported effort cannot
    // leave an unusable ask default behind.
    const resolvedSelection = await llm.resolveCallConfig(selection)
    if (config.model !== undefined || config.effort !== undefined || config.saveLanguage) await saveAskDefaults(nextDefaults)
    if (config.configureOnly) {
      progress.stop()
      io.stdout.write(`${text.config.saved}\n${text.config.language(config.lang)}\n${text.config.provider(resolvedSelection.provider)}\n${text.config.model(resolvedSelection.model)}\n${text.config.effort(resolvedSelection.reasoningEffort ?? text.config.providerDefault)}\n`)
      exitAfterReady(ctx, io, 0)
      return
    }
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    }

    let handle
    let resumed = true
    progress.update(text.progress.restoringSession)
    try {
      handle = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    } catch (error: unknown) {
      if (!isSessionMissing(error)) throw error
      resumed = false
      progress.update(text.progress.creatingSession)
      handle = await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
    }
    await handle.agent.whenIdle()
    progress.update(resumed ? text.progress.resumedSession(sessionId) : text.progress.createdSession(sessionId))

    const stopAgentStatus = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== handle.agent || status !== 'running' || streamedText) return
      progress.update(text.progress.thinking)
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
      const activity = activityFor(event, text)
      if (activity !== undefined) progress.update(activity)
    }, { global: true })
    stopEvents = (): void => {
      stopAgentStatus()
      stopSessionEvents()
    }

    const firstSeq = handle.agent.session.seq
    progress.update(text.progress.thinking)
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    progress.flushThinking()
    if (!streamedText) progress.update(text.progress.savingHistory)
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
    exitAfterReady(ctx, io, outcome.reason?.kind === 'completed' ? 0 : 1)
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
