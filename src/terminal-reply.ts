/** Editable, package-relative reply guidance for terminal asks. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Read once per ask; a blank policy disables the additional prompt section. */
export async function loadTerminalReplyPolicy(path = new URL('../TERMINAL_REPLY.md', import.meta.url)): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch (error: unknown) {
    throw new Error(`dsh-ask: cannot read terminal reply policy ${fileURLToPath(path)}: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}
