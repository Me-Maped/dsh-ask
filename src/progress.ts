/** Writable stream that can report interactive-terminal support. */
export interface StatusStream {
  write(chunk: string): unknown
  isTTY?: boolean
}

/** Supported native-terminal output presets. */
export const OUTPUT_STYLES = ['auto', 'plain', 'subtle', 'contrast'] as const
export type OutputStyle = typeof OUTPUT_STYLES[number]

/** Options that affect terminal-only rendering, never stdout answer content. */
export interface ProgressLabels {
  /** Heading for compact reasoning rows. */
  thought: string
  /** Heading for completed tool-call rows. */
  operation: string
}

export interface ProgressOptions {
  /** Called immediately before a durable activity row is written. */
  beforeActivity?: () => void
  /** Native-terminal presentation preset; `plain` avoids terminal control sequences. */
  style?: OutputStyle
  /** Localized durable-activity labels. */
  labels?: ProgressLabels
}

/** Lifecycle and activity controls for terminal progress output. */
export interface Progress {
  start(message: string): void
  update(message: string): void
  /** Add one streaming reasoning fragment; complete entries are rendered in a muted style. */
  appendThinking(text: string): void
  /** Render any buffered reasoning fragment now. */
  flushThinking(): void
  /** Render one durable, prominent operation row. */
  operation(message: string): void
  stop(): void
}

/** Frames rendered only while an interactive terminal is waiting. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_THINKING_CHARS = 160
const MAX_OPERATION_CHARS = 180
const MAX_TOOL_NAME_CHARS = 48
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  gray: '\x1b[2;90m',
  thinking: '\x1b[2;3;90m',
  cyan: '\x1b[1;36m',
  yellow: '\x1b[1;93m',
  bold: '\x1b[1m',
} as const

/** ANSI choices deliberately stay within broadly supported SGR sequences. */
const STYLE_PRESETS: Record<Exclude<OutputStyle, 'plain'>, {
  status: string
  thinking: string
  operation: string
}> = {
  auto: { status: ANSI.gray, thinking: ANSI.thinking, operation: ANSI.cyan },
  subtle: { status: ANSI.dim, thinking: ANSI.dim, operation: ANSI.bold },
  contrast: { status: ANSI.gray, thinking: ANSI.gray, operation: ANSI.yellow },
}

/** Collapse control characters so model-provided activity cannot control the terminal. */
function inline(value: string): string {
  return value
    .replaceAll('\x1b', '')
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep one activity row compact without relying on terminal-width APIs. */
function shorten(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

/** Read a concise string argument from a parsed tool-call object. */
function stringArgument(args: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (args === undefined) return undefined
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && inline(value) !== '') return inline(value)
  }
  return undefined
}

/**
 * Build a compact operation description from the authoritative final tool-call
 * event. Shell commands are shown verbatim (within a fixed bound); file and
 * search tools show their most useful target instead of a full JSON payload.
 */
export function formatToolCall(name: string, argumentsJson: string): string {
  const tool = shorten(inline(name) || 'tool', MAX_TOOL_NAME_CHARS)
  let args: Record<string, unknown> | undefined
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>
    }
  } catch {
    // A malformed tool payload must never interrupt the ask run.
  }

  const command = stringArgument(args, ['command', 'cmd', 'script'])
  if (command !== undefined) return shorten(`${tool} $ ${command}`, MAX_OPERATION_CHARS)

  const target = stringArgument(args, ['file_path', 'path', 'url'])
  const query = stringArgument(args, ['query', 'pattern'])
  const description = stringArgument(args, ['description'])
  const detail = query !== undefined && target !== undefined
    ? `${query} · ${target}`
    : target ?? query ?? description
  return detail === undefined ? tool : shorten(`${tool} ${detail}`, MAX_OPERATION_CHARS)
}

/** Render terminal lifecycle status and compact activity rows. */
export function createProgress(stderr: StatusStream, options: ProgressOptions = {}): Progress {
  const { beforeActivity, style = 'auto', labels = { thought: '思考', operation: '执行' } } = options
  const interactive = stderr.isTTY === true && style !== 'plain'
  const styled = interactive && process.env.NO_COLOR === undefined
  const preset = STYLE_PRESETS[style === 'plain' ? 'auto' : style]
  let message = ''
  let frame = 0
  let timer: NodeJS.Timeout | undefined
  let active = false
  let spinnerVisible = false
  let thinking = ''

  const clearSpinner = (): void => {
    if (!interactive || !spinnerVisible) return
    stderr.write('\r\x1b[2K')
    spinnerVisible = false
  }

  const render = (): void => {
    if (!active) return
    if (interactive) {
      const row = `${SPINNER_FRAMES[frame]} dsh-ask · ${message}`
      stderr.write(`\r\x1b[2K${styled ? `${preset.status}${row}${ANSI.reset}` : row}`)
      spinnerVisible = true
      frame = (frame + 1) % SPINNER_FRAMES.length
      return
    }
    stderr.write(`dsh-ask · ${message}\n`)
  }

  const writeActivity = (row: string): void => {
    beforeActivity?.()
    clearSpinner()
    stderr.write(row)
    if (interactive && active) render()
  }

  const emitThinking = (value: string): void => {
    const text = inline(value)
    if (text === '') return
    const row = `  ${labels.thought} · ${shorten(text, MAX_THINKING_CHARS)}`
    writeActivity(`${styled ? `${preset.thinking}${row}${ANSI.reset}` : row}\n`)
  }

  const flushThinking = (): void => {
    if (thinking === '') return
    emitThinking(thinking)
    thinking = ''
  }

  const stop = (): void => {
    if (!active) return
    active = false
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    clearSpinner()
  }

  return {
    start(next) {
      if (active) stop()
      active = true
      message = next
      render()
      if (interactive) timer = setInterval(render, 100)
    },
    update(next) {
      if (!active || next === message) return
      message = next
      render()
    },
    appendThinking(text) {
      if (text === '') return
      thinking += text
      let newline = thinking.indexOf('\n')
      while (newline !== -1) {
        emitThinking(thinking.slice(0, newline))
        thinking = thinking.slice(newline + 1)
        newline = thinking.indexOf('\n')
      }
      while (thinking.length > MAX_THINKING_CHARS) {
        const boundary = thinking.lastIndexOf(' ', MAX_THINKING_CHARS)
        const end = boundary > MAX_THINKING_CHARS / 2 ? boundary : MAX_THINKING_CHARS
        emitThinking(thinking.slice(0, end))
        thinking = thinking.slice(end).trimStart()
      }
    },
    flushThinking,
    operation(next) {
      const row = `▶ ${labels.operation} · ${inline(next) || 'tool'}`
      writeActivity(`${styled ? `${preset.operation}${row}${ANSI.reset}` : row}\n`)
    },
    stop,
  }
}
