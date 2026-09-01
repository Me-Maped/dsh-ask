/** Small, typed localization catalog for dsh-ask-owned terminal text. */

export const ASK_LANGUAGES = ['zh', 'en'] as const
export type AskLanguage = typeof ASK_LANGUAGES[number]

export interface AskMessages {
  command: {
    description: string
    help: string
    task: string
    newSession: string
    session: string
    model: string
    effort: string
    language: string
    provider: string
    modes: string
    ask: string
    configure: string
    inspect: string
    examples: string
    defaults: string
    questionRequired: string
  }
  progress: {
    preparingSession: string
    restoringSession: string
    creatingSession: string
    thinking: string
    analyzing: string
    generating: string
    callingTool: (name: string) => string
    organizingToolResult: string
    savingHistory: string
    resumedSession: (id: string) => string
    createdSession: (id: string) => string
    thought: string
    operation: string
  }
  config: {
    saved: string
    provider: (value: string) => string
    model: (value: string) => string
    effort: (value: string) => string
    providerDefault: string
    language: (value: AskLanguage) => string
  }
  provider: {
    none: string
    unknown: (id: string) => string
    provider: (id: string, name?: string) => string
    model: (id: string, name?: string) => string
    noModels: string
    effortUnavailable: string
    effort: (id: string, name?: string, isDefault?: boolean) => string
  }
}

const zh: AskMessages = {
  command: {
    description: '提交问题或管理 dsh-ask 默认配置。同一终端和目录会复用持久会话。',
    help: '显示命令、选项和示例', task: '问题文本；仅查看或保存配置时可省略',
    newSession: '使用独立的持久会话提问', session: '在指定持久会话中提问',
    model: '保存 ask 默认模型；没有问题时显示当前配置并退出',
    effort: '保存 ask 默认推理强度；没有问题时显示当前配置并退出',
    language: '保存 ask 默认输出语言（zh 或 en）；没有问题时显示当前配置并退出',
    provider: '列出 provider、模型和推理强度能力；不发起聊天或修改配置',
    modes: '模式：', ask: '提问：提供问题文本后发送请求、流式输出回答并退出。',
    configure: '配置：不提供问题时，保存默认配置并显示当前生效配置。',
    inspect: '查询：--provider 仅输出能力列表，不发起聊天。', examples: '示例：',
    defaults: '默认配置仅存于 $DSH_HOME/ask/config.json（未设置 DSH_HOME 时为 ~/.dsh/ask/config.json），不会修改 Web、TUI 或其他 profile 的默认设置。',
    questionRequired: '错误：需要提供问题，例如：dsh --profile ask "这个函数做什么？"',
  },
  progress: {
    preparingSession: '正在准备持久会话…', restoringSession: '正在恢复持久会话…', creatingSession: '正在创建持久会话…',
    thinking: '正在思考…', analyzing: '正在分析问题…', generating: '正在生成回答…', callingTool: name => `正在调用工具：${name}`,
    organizingToolResult: '正在整理工具结果…', savingHistory: '正在保存会话历史…', resumedSession: id => `已恢复会话 ${id}`,
    createdSession: id => `已创建会话 ${id}`, thought: '思考', operation: '执行',
  },
  config: {
    saved: 'dsh-ask：默认配置已保存', provider: value => `Provider：${value}`, model: value => `模型：${value}`,
    effort: value => `推理强度：${value}`, providerDefault: 'provider 默认值', language: value => `语言：${value === 'zh' ? '中文（zh）' : 'English（en）'}`,
  },
  provider: {
    none: '没有已注册的 provider', unknown: id => `provider "${id}" 未注册`, provider: (id, name) => `provider ${id}${name === undefined || name === id ? '' : `（${name}）`}`,
    model: (id, name) => `  模型 ${id}${name === undefined || name === id ? '' : `（${name}）`}`, noModels: '  （没有已公布的模型）',
    effortUnavailable: '    推理强度（provider 默认 / 不可选择）', effort: (id, name, isDefault) => `    推理强度 ${id}${isDefault === true ? '［默认］' : ''}${name === undefined || name === id ? '' : `（${name}）`}`,
  },
}

const en: AskMessages = {
  command: {
    description: 'Ask questions or manage dsh-ask defaults. The same terminal and directory reuse one durable conversation.',
    help: 'show commands, options, and examples', task: 'question text; omit when only viewing or saving defaults',
    newSession: 'ask in a fresh persisted conversation', session: 'ask in a named persisted session',
    model: 'save ask default model; without a question, print active settings and exit',
    effort: 'save ask default reasoning effort; without a question, print active settings and exit',
    language: 'save ask default output language (zh or en); without a question, print active settings and exit',
    provider: 'list provider/model/effort capabilities; no chat or setting changes',
    modes: 'Modes:', ask: 'Ask: a non-empty question sends one request, streams the answer, then exits.',
    configure: 'Configure: with no question, save defaults and print active settings.',
    inspect: 'Inspect: --provider lists capabilities and exits without chatting.', examples: 'Examples:',
    defaults: 'Defaults are stored only for dsh-ask at $DSH_HOME/ask/config.json (~/.dsh/ask/config.json when DSH_HOME is unset). They do not alter Web, TUI, or other profile defaults.',
    questionRequired: 'error: a question is required, for example: dsh --profile ask "what does this function do?"',
  },
  progress: {
    preparingSession: 'Preparing durable session…', restoringSession: 'Restoring durable session…', creatingSession: 'Creating durable session…',
    thinking: 'Thinking…', analyzing: 'Analyzing question…', generating: 'Generating answer…', callingTool: name => `Calling tool: ${name}`,
    organizingToolResult: 'Organizing tool result…', savingHistory: 'Saving session history…', resumedSession: id => `Resumed session ${id}`,
    createdSession: id => `Created session ${id}`, thought: 'Thought', operation: 'Run',
  },
  config: {
    saved: 'dsh-ask: default configuration saved', provider: value => `Provider: ${value}`, model: value => `Model: ${value}`,
    effort: value => `Reasoning effort: ${value}`, providerDefault: 'provider default', language: value => `Language: ${value === 'zh' ? 'Chinese (zh)' : 'English (en)'}`,
  },
  provider: {
    none: 'no registered providers', unknown: id => `provider "${id}" is not registered`, provider: (id, name) => `provider ${id}${name === undefined || name === id ? '' : ` (${name})`}`,
    model: (id, name) => `  model ${id}${name === undefined || name === id ? '' : ` (${name})`}`, noModels: '  (no advertised models)',
    effortUnavailable: '    effort (provider default / not selectable)', effort: (id, name, isDefault) => `    effort ${id}${isDefault === true ? ' [default]' : ''}${name === undefined || name === id ? '' : ` (${name})`}`,
  },
}

export function isAskLanguage(value: unknown): value is AskLanguage {
  return typeof value === 'string' && (ASK_LANGUAGES as readonly string[]).includes(value)
}

export function messagesFor(language: AskLanguage): AskMessages {
  return language === 'en' ? en : zh
}
