/** Writable stream that can report interactive-terminal support. */
export interface StatusStream {
  write(chunk: string): unknown
  isTTY?: boolean
}

/** Lifecycle controls for a terminal progress indicator. */
export interface Progress {
  start(message: string): void
  update(message: string): void
  stop(): void
}

/** Frames rendered only while an interactive terminal is waiting. */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

/** Render terminal lifecycle status without exposing private model reasoning. */
export function createProgress(stderr: StatusStream): Progress {
  const interactive = stderr.isTTY === true
  let message = ''
  let frame = 0
  let timer: NodeJS.Timeout | undefined

  const render = (): void => {
    if (interactive) {
      stderr.write(`\r\x1b[2K${SPINNER_FRAMES[frame]} dsh-ask · ${message}`)
      frame = (frame + 1) % SPINNER_FRAMES.length
      return
    }
    stderr.write(`dsh-ask · ${message}\n`)
  }

  return {
    start(next) {
      message = next
      render()
      if (interactive) timer = setInterval(render, 100)
    },
    update(next) {
      if (next === message) return
      message = next
      render()
    },
    stop() {
      // Once text is streaming, a later cleanup must not erase the answer line.
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
      stderr.write('\r\x1b[2K')
    },
  }
}
