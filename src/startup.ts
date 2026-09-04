/** Command-line startup provider for dsh-ask. @module @dsh-local/dsh-ask/startup */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { loadAskDefaultsSync } from './ask-default.js'
import { isAskLanguage, messagesFor, type AskLanguage } from './i18n.js'

export const name = 'ask-startup'
export const inject = ['cmdlineArgs']
export const ASK_STARTUP_SERVICE = 'askStartup'

export interface AskStartupValues {
  task: string
  fresh: boolean
  session?: string
  model?: string
  effort?: string
  lang: AskLanguage
  saveLanguage: boolean
  listProviders: boolean
  provider?: string
  configureOnly: boolean
}

/** Read a --lang value before Commander may synchronously print --help. */
function explicitLanguage(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === undefined) continue
    if (arg.startsWith('--lang=')) return arg.slice('--lang='.length)
    if (arg === '--lang') return args[index + 1]
  }
  return undefined
}

/** Resolve the language used for all startup-time output. */
export function startupLanguage(args: readonly string[]): AskLanguage {
  const requested = explicitLanguage(args)
  if (isAskLanguage(requested)) return requested
  return loadAskDefaultsSync().lang ?? 'zh'
}

/** Create a fresh, localized Commander program for one invocation. */
export function askCommand(lang: AskLanguage = 'zh'): Command {
  const text = messagesFor(lang).command
  return new Command()
    .name('dsh --profile ask')
    .description(text.description)
    .helpOption('-h, --help', text.help)
    .argument('[task...]', text.task)
    .option('--new', text.newSession)
    .option('--session <id>', text.session)
    .option('-m, --model <id>', text.model)
    .option('-e, --effort <id>', text.effort)
    .option('--lang <zh|en>', text.language)
    .option('--provider [id]', text.provider)
    .addHelpText('after', `
${text.modes}
  ask       ${text.ask}
  configure ${text.configure}
  inspect   ${text.inspect}

${text.examples}
  dsh --profile ask -h
  dsh --profile ask --lang=en --help
  dsh --profile ask "what does this function do?"
  dsh --profile ask --model=gpt-5.6-terra
  dsh --profile ask --effort=high
  dsh --profile ask --lang=en
  dsh --profile ask -m gpt-5.6-terra -e high "review this design"
  dsh --profile ask --provider
  dsh --profile ask --provider=deepseek
  dsh --profile ask --provider=deepseek --model=deepseek-chat

${text.defaults}
`)
}

export function apply(ctx: Context): void {
  const args = ctx.get('cmdlineArgs')?.get() ?? []
  const lang = startupLanguage(args)
  const text = messagesFor(lang).command
  const program = askCommand(lang)
  program.action(() => {
    const task = program.args.join(' ')
    const options: { new?: boolean; session?: string; model?: string; effort?: string; lang?: string; provider?: true | string } = program.opts()
    if (options.lang !== undefined && !isAskLanguage(options.lang)) program.error(`error: ${options.lang} is not a supported language (zh, en)`)
    const selectedLanguage: AskLanguage = isAskLanguage(options.lang) ? options.lang : lang
    const configureOnly = task.trim() === '' && (
      options.model !== undefined
      || options.effort !== undefined
      || options.lang !== undefined
      || typeof options.provider === 'string'
    )
    if (task.trim() === '' && options.provider === undefined && !configureOnly) program.error(text.questionRequired)
    ctx.provide(ASK_STARTUP_SERVICE, {
      task,
      fresh: options.new === true,
      lang: selectedLanguage,
      saveLanguage: options.lang !== undefined,
      listProviders: options.provider === true,
      configureOnly,
      ...(options.session === undefined ? {} : { session: options.session }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.effort === undefined ? {} : { effort: options.effort }),
      ...(typeof options.provider === 'string' ? { provider: options.provider } : {}),
    } satisfies AskStartupValues)
  })
  parseCmdline(ctx, program)
}
