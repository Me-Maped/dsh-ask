// Deterministic, network-free provider for the installed-runtime smoke test.
import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const runtimeRequire = createRequire(process.env.DSH_ASK_TEST_RUNTIME)
const { LlmAdapter, LlmError } = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-llm')).href)
export const name = 'ask-runtime-test-provider'
export const inject = ['llm']

class TestAdapter extends LlmAdapter {
  async listModels(provider) {
    return ['smoke', 'alternate'].map(id => ({ provider, id, name: id }))
  }

  async resolveModel(provider, id) {
    return {
      provider, id, name: id, inputModalities: ['text'],
      context: { contextWindow: 128000 },
      reasoning: { efforts: [{ id: 'high', name: 'High' }] },
    }
  }

  async *stream(options) {
    const prompts = options.messages
      .filter(message => message.role === 'user' && message.source?.kind === 'user')
      .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    appendFileSync(process.env.DSH_ASK_TEST_REQUESTS, JSON.stringify({
      prompts, model: options.model, effort: options.reasoningEffort,
      system: options.messages.filter(message => message.role === 'system'),
    }) + '\n')
    if (prompts.at(-1) === 'FAIL') throw new LlmError('intentional smoke failure', 'SMOKE_FAILURE')
    yield { type: 'reasoning-delta', index: 0, text: 'Checking persisted history' }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Checking persisted history' } }
    const text = `model=${options.model}; prompts=${prompts.join('|')}`
    yield { type: 'text-delta', index: 1, text: text.slice(0, 6) }
    await new Promise(resolve => setTimeout(resolve, 30))
    yield { type: 'text-delta', index: 1, text: text.slice(6) }
    yield { type: 'block-end', index: 1, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export function apply(ctx) {
  const dispose = ctx.llm.registerAdapter(['ask-smoke'], new TestAdapter())
  ctx.on('dispose', dispose)
  ctx.provide('askRuntimeTestReady', true)
}
