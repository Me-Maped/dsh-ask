/**
 * Command-line startup provider for the terminal ask bundle.
 * It parses the task and session flags before publishing values consumed by the
 * runner's lazy configuration.
 *
 * @module @dsh-local/dsh-ask/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'ask-startup'

/** Services required before the question can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and consumed by the runner row. */
export const ASK_STARTUP_SERVICE = 'askStartup'

/** Values supplied to the runner configuration by {@link ASK_STARTUP_SERVICE}. */
export interface AskStartupValues {
  /** Prompt text for this invocation. */
  task: string
  /** Whether this invocation creates a fresh persisted session. */
  fresh: boolean
  /** Explicit persisted session id, when requested. */
  session?: string
}

/** Create a fresh Commander program for parsing one dsh-ask invocation. */
function askCommand(): Command {
  return new Command()
    .name('dsh --profile ask')
    .description('Ask one question in the current directory, stream the answer, and exit. The same terminal and directory keep one durable conversation until the terminal restarts.')
    .helpOption('-h, --help', 'show this help')
    .argument('[task...]', 'the question; multiple words are joined by spaces')
    .option('--new', 'start a fresh persisted conversation for this ask (next plain ask resumes the terminal conversation again)')
    .option('--session <id>', 'resume (or create) the session with this id instead of the default per-directory one')
    .addHelpText('after', `
Examples:
  dsh --profile ask "what does this function do?"     ask one question and exit
  dsh --profile ask --new "start from scratch"        ignore the default conversation for this ask
  dsh --profile ask --session my-id "continue me"     resume a specific session id
`)
}

/** Parse the invocation and provide startup values for the runner row. */
export function apply(ctx: Context): void {
  const program = askCommand()
  program.action(() => {
    const task = program.args.join(' ')
    if (task.trim() === '') {
      program.error('error: a question is required, for example: dsh --profile ask "what does this function do?"')
    }
    const options: { new?: boolean; session?: string } = program.opts()
    ctx.provide(ASK_STARTUP_SERVICE, {
      task,
      fresh: options.new === true,
      ...options.session === undefined ? {} : { session: options.session },
    } satisfies AskStartupValues)
  })
  parseCmdline(ctx, program)
}
