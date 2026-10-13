# Scope Boundary: Choose Provider and Model

## Work Item

No work item exists. The operator's request, typed when invoking `plan-a-change` on 2026-10-13, is the only boundary
this run has.

## Stated Scope

> to support different claude code models, and add support for the other LLM services and models. the [Image #4] header
> row should show the current provider and model selection (including whether or not it's local or API). when clicking
> "New Chat", the pop up menu should give me a list of available providers. when i select a provider, it gives me
> available models and versions to select. if the model supports thinking levels, or equivalent, like Claude does, show
> a thinking level list to choose from after selecting the model. save the selected provider, model, level to a json
> config file at .3pitor/config.json, under a "selectedModel" section. when the new chat pop up is shown, it reads this
> to select the defaults. if there is no config file, or selected model section, default to Claude, Haiku v5.5 on medium
> thinking. also, when the app first loads, use the config or default to select the current provider so the user
> doesn't have to always go through the new chat every time they restart

Image #4 is a screenshot of the chat panel's header row: the heading "CLAUDE" on the left and the "New chat" button on
the right.

## Stated Exclusions

None stated in the request.

## Operator-Confirmed Scope

The confirmation turn restated the following, and the operator accepted it with "looks good":

- Other services: OpenAI and Google Gemini through their APIs, each with its own API key, and Ollama as a local service
  running models on the operator's machine. Claude appears two ways: "Claude (local)", the `claude` program on the
  operator's subscription, and "Claude (API)", the operator's Anthropic key.
- "Local" means runs through a program or service on this computer; "API" means calls a hosted API with a key.
- The area: the chat engine (how a model is built, the Claude backend, the `claude` program adapter), startup's handling
  of `--claude` and `MODEL`, a new server route to read and write the config, and the panel header and New chat menu.
- Design decisions, including the fate of the `--claude` flag, are the planner's to make and log; behavior changes are
  reported in the final summary.
- One branch, `choose-provider-and-model`, holds both the plan and its implementation, committed as the work goes.

Output folder: `docs/changes/choose-provider-and-model/`.

## Direction of Travel

Earlier changes this one builds on, not scope evidence for it:

- `docs/changes/claude-api-or-cli-adapter/` — introduced `ClaudeBackend`, `--claude=auto|api|cli`, and the `claude`
  program model.
- `docs/changes/prompt-caching-middleware/` — the cache middleware the API backend wraps its model in.
