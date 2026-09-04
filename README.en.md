# dsh-ask

[中文](README.md) | English

`dsh-ask` is a small [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle for terminal questions: it runs one turn in the current directory, streams the visible answer, and exits. It does not start the TUI.

## Behavior

```sh
dsh --profile ask "what does this function do?"
```

The default conversation is scoped to the absolute current directory and the current parent shell. Consecutive asks from one terminal and directory resume its durable session. A new terminal receives a new default session, even in the same directory. Use the Web session surface to browse or recover earlier sessions. `--new` creates a separate persisted session for one run; `--session <id>` selects a specific persisted session. `--provider <id>`, `--model <id>`, and `--effort <id>` update **dsh-ask-only** defaults for later asks; they do not change DSH’s global default.

At the end of every turn the runner calls `sessions.flush()`. DSH therefore persists the canonical event log before the process exits. With DSH's default JSONL backend, the log is stored under `$DSH_HOME/sessions/<encoded-cwd>/<session-id>/session.jsonl.zstd` (normally `~/.dsh/sessions/...`). The log contains user messages, assembled assistant messages, tool calls/results, and turn boundaries; dsh-ask does not create a competing history file.

## Terminal output

While a terminal is waiting, dsh-ask renders a spinner on stderr with lifecycle labels such as **preparing session**, **thinking**, and **calling a tool**. Model `reasoning-delta` chunks are coalesced into compact, persistent **thinking** rows, so longer requests show meaningful progress before the final answer begins. Each row is whitespace-normalized and bounded rather than printed token by token.

A completed `tool/call` creates a separate **operation** row. It shows the tool plus the useful part of its final arguments: shell tools show the command, file tools show the path, and search tools show the pattern and path. Tool results are not dumped to the terminal. In an interactive terminal, thinking rows use the terminal's native dim/italic gray SGR style; operation rows use bold cyan. No font is bundled or resized. When stderr is redirected, both forms are plain line-oriented text without ANSI styling (and `NO_COLOR` disables color in a TTY).

Visible assistant `text-delta` content continues to stream unchanged to stdout; the first such chunk removes the transient spinner. If a later step reasons or calls a tool after visible text has started, its permanent row is placed on a separate TTY line rather than being dropped or written into the answer line. Activity stays on stderr, so `dsh ... > answer.txt` still writes only the answer. If a provider supplies no visible chunks, dsh-ask falls back to printing the completed assistant message after the turn ends.

### Model and reasoning effort

```sh
# List every registered provider, model, and selectable effort.
dsh --profile ask --provider

# Save ask's default provider and print the active configuration without starting a chat.
# Use equals so the optional value cannot consume question text.
dsh --profile ask --provider=deepseek

# Save a provider and model, then ask immediately.
dsh --profile ask --provider=deepseek --model=deepseek-chat "explain this code quickly"

# Save ask's default model and print the active configuration without starting a chat.
dsh --profile ask --model=deepseek-chat

# Save ask's default reasoning effort without starting a chat.
dsh --profile ask --effort=high
```

The default lives in `$DSH_HOME/ask/config.json` (or `~/.dsh/ask/config.json` when `DSH_HOME` is unset) and affects only `dsh-ask`. Every ask reads it, then sends requests through the saved provider and model; if no provider is saved, it falls back to the configured DSH default provider. It never changes Web, TUI, or other profile model settings. Writes use atomic replacement, so an invalid provider, model, or unsupported effort cannot replace a working configuration. With no question text, `--provider=<id>`, `--model=<id>`, `--effort=<id>`, or any combination only save settings, start no chat, and print the active provider, model, and effort.

Without a value, `--provider` lists every registered provider. The output includes each model id plus its raw supported effort ids, display names, and default marker. It does not start a chat or write the defaults file. `--provider=<id>` saves that provider as the ask default. Without `--model` in the same command, the previous model (and effort) is dropped and the first advertised model of the new provider is used, so a model id from another provider cannot be sent to the newly selected adapter.

`--effort` is the raw id exposed by the provider/model, not a fixed `low`/`high` enum. DSH validates it against the current provider and final model before saving. `--model` on its own clears the saved effort so the new model uses its provider default, avoiding a model-specific id leaking from the old model. Passing both `--model` and `--effort` saves both values.

### Language

`dsh-ask` supports only Chinese (`zh`) and English (`en`), defaulting to `zh`. The language is saved in the ask-only defaults. Precedence is explicit `--lang`, the saved default, then `zh`.

```sh
# Save English as the ask default; no chat is started.
dsh --profile ask --lang=en

# Render this help in English only; do not write defaults.
dsh --profile ask --lang=en --help

# Save English and ask immediately.
dsh --profile ask --lang en "Explain this code"
```

Language controls `--help`, configuration success output, provider/model/effort inspection, spinners, thinking rows, tool activity, and ask-owned argument prompts. Model answers and raw provider/DSH error details are not translated.

### Style presets

`outputStyle` defaults to `auto`. Set `DSH_ASK_STYLE` for one machine, or override the `ask-runner` row in a later profile `cordis.patch.yml` for a persistent profile setting:

```yaml
- id: ask-runner
  config:
    outputStyle: plain
```

| Preset | Behavior |
| --- | --- |
| `auto` | Default TTY spinner, dim/italic gray thinking, and bold cyan operations. |
| `plain` | Line-oriented output only: no color, SGR, cursor clearing, or spinner animation. Recommended for older terminals, remote consoles, and strict logs. |
| `subtle` | Uses only standard dim/bold emphasis, without color or italics. |
| `contrast` | Keeps muted thinking and uses bright yellow operations for high visibility. |

`NO_COLOR` still disables SGR color/style in the styled presets; use `plain` when terminal control sequences themselves are incompatible.

## Commands

```sh
# Continue this terminal's conversation in the current directory.
dsh --profile ask "continue the implementation"

# Start a separate persisted thread for this one invocation.
dsh --profile ask --new "investigate an unrelated issue"

# Resume or create a named persisted session.
dsh --profile ask --session refactor-auth "continue the refactor"

# Save the default model and reasoning effort, then ask with them.
dsh --profile ask -m deepseek-reasoner -e high "review this design"
```

`DSH_ASK_SESSION` is an optional environment override for wrappers that need a stable, isolated default session id.

## Shell integrations

The bundle does **not** edit shell configuration when it is installed. Shell integrations are explicit, separate init commands so Bash, Zsh, PowerShell, and other shells can follow the same pattern.

Each integration is a plain template under `src/templates/`. `pnpm run build` copies those files to `lib/templates/`, allowing the installed binary to read its package-provided template at runtime instead of embedding shell syntax in JavaScript.

### Fish

After adding the bundle to the `ask` profile, install Fish support with:

```sh
dsh plugin --profile ask exec dsh-ask init fish
source ~/.config/fish/conf.d/zz-dsh-ask.fish
```

New Fish shells load the generated `conf.d/zz-dsh-ask.fish` file automatically. It intercepts unknown interactive commands, joins them into a question, and runs:

```fish
command dsh --profile $DSH_ASK_PROFILE -- $text
```

The screenshots below show an unknown Fish command being answered, followed by a question that resumes the same terminal-scoped conversation.

![Fish routes an unknown command to dsh-ask](doc/fish_01.png)

![Fish follow-up reuses the terminal-scoped session](doc/fish_02.png)

`DSH_ASK_PROFILE` defaults to `ask`; set it before starting Fish to use another profile name. The generated wrapper preserves a pre-existing `fish_command_not_found` handler as a fallback when `dsh` is unavailable. The installer refuses to overwrite a same-named file that it did not generate.

### Bash

Install the Bash snippet, then source it in the current interactive shell:

```bash
dsh plugin --profile ask exec dsh-ask init bash
source "${XDG_CONFIG_HOME:-$HOME/.config}/dsh-ask/bash-command-not-found.bash"
```

The installer never edits `~/.bashrc`. To load it in future shells, add that same `source` line to `~/.bashrc` **after** any distribution-provided `command-not-found` setup. The template preserves an existing `command_not_found_handle` as a fallback, rejects newline-containing input, and sets `DSH_SHELL=1` only for the child `dsh` invocation.

### Zsh

Install and source the Zsh snippet after your framework or plugins have initialized:

```zsh
dsh plugin --profile ask exec dsh-ask init zsh
source "${XDG_CONFIG_HOME:-$HOME/.config}/dsh-ask/zsh-command-not-found.zsh"
```

The installer never edits `~/.zshrc`. To make it persistent, add the same line to `~/.zshrc` after Oh My Zsh, Prezto, or another plugin that defines `command_not_found_handler`. The template keeps the previous handler as a fallback and invokes `dsh --profile ${DSH_ASK_PROFILE:-ask}` for eligible unknown interactive commands.

### PowerShell (experimental)

Install and dot-source the PowerShell snippet in a supported interactive host:

```powershell
dsh plugin --profile ask exec dsh-ask init powershell
. "$HOME/.config/dsh-ask/powershell-command-not-found.ps1"
```

Use the exact installation path printed by the command when `XDG_CONFIG_HOME` is set or on a platform with a different home directory convention. The installer never edits `$PROFILE`; add the same dot-source command to `$PROFILE` manually if you choose to persist it.

This integration uses `$ExecutionContext.InvokeCommand.CommandNotFoundAction`, preserves the existing delegate as a fallback, and is intentionally marked experimental. PowerShell command lookup and interactivity differ across Windows PowerShell, PowerShell 7, terminal hosts, and remote runspaces; test it in every host you use before persisting it.

### Customizing or adding a shell

To customize an integration while developing the bundle, edit its file under `src/templates/` (for example, `fish.fish`, `bash.bash`, `zsh.zsh`, or `powershell.ps1`) and run `pnpm run build` before testing or packing. To add another shell, add its template and a matching entry to `SHELL_INTEGRATIONS` in `src/bin/dsh-ask.ts`. The entry defines the template file, generated-file marker, installation path, and activation command; the shared installer handles reading, overwrite protection, and writing the file.

## TypeScript development

The maintained source is TypeScript under `src/`; `lib/` contains generated ESM JavaScript, declarations, and source maps. Do not edit `lib/` by hand. Build before using a changed linked package or packing it for distribution:

```sh
pnpm install
pnpm run typecheck
pnpm run build
```

The package keeps Cordis and DSH packages as peer dependencies so a profile supplies the same service instances used by the bundle. The [TypeScript maintenance notes](docs/typescript-comparison.md) document the source/artifact layout and supported validation commands.

## Development and publication

The checked-out package is locally named `@dsh-local/dsh-ask` and marked `private` to avoid accidentally publishing under a scope that is not owned. Before publishing it, set `name` to a scope you control and set `private` to `false`. Runtime DSH packages are peer dependencies so the bundle shares the profile's Cordis and DSH service instances rather than loading duplicates.

The local profile used for development links this checkout. A published bundle can be added in the same way as other DSH bundles, for example:

```sh
dsh plugin --profile ask add <your-package-spec>
dsh plugin --profile ask exec dsh-ask init fish
```
