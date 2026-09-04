/** Persisted, ask-only model defaults. @module @dsh-local/dsh-ask/default */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isAskLanguage, type AskLanguage } from './i18n.js'

/** The subset of model selection owned by dsh-ask rather than global DSH settings. */
export interface AskDefaults {
  lang?: AskLanguage
  provider?: string
  model?: string
  effort?: string
}

/** Location of the per-user ask defaults; DSH_HOME keeps it alongside DSH state. */
export function askDefaultsPath(dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')): string {
  return join(dshHome, 'ask', 'config.json')
}

function parseDefaults(raw: string, path: string): AskDefaults {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error(`dsh-ask: invalid JSON in default configuration ${path}`) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`dsh-ask: default configuration ${path} must be a JSON object`)
  }
  const { lang, provider, model, effort } = value as Record<string, unknown>
  if (lang !== undefined && !isAskLanguage(lang)) throw new Error(`dsh-ask: default configuration ${path} has an invalid language`)
  if (provider !== undefined && (typeof provider !== 'string' || provider === '')) throw new Error(`dsh-ask: default configuration ${path} has an invalid provider`)
  if (model !== undefined && (typeof model !== 'string' || model === '')) throw new Error(`dsh-ask: default configuration ${path} has an invalid model`)
  if (effort !== undefined && (typeof effort !== 'string' || effort === '')) throw new Error(`dsh-ask: default configuration ${path} has an invalid effort`)
  return {
    ...(lang === undefined ? {} : { lang }),
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(effort === undefined ? {} : { effort }),
  }
}

/** Synchronously read defaults for startup-time help localization. */
export function loadAskDefaultsSync(path = askDefaultsPath()): AskDefaults {
  try { return parseDefaults(readFileSync(path, 'utf8'), path) } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

/** Read ask-only defaults, treating a missing file as an empty configuration. */
export async function loadAskDefaults(path = askDefaultsPath()): Promise<AskDefaults> {
  try { return parseDefaults(await readFile(path, 'utf8'), path) } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

/** Atomically replace ask-only defaults without touching DSH's global settings. */
export async function saveAskDefaults(defaults: AskDefaults, path = askDefaultsPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(defaults, undefined, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}
