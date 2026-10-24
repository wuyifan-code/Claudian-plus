# DeepSeek Harness provider

This provider is independently implemented against official Harness HTTP Remote and WebSocket mux contracts. It does not import or merge Claudian upstream implementation code.

## Setup

1. Install the official npm DeepSeek Harness CLI and configure a working provider using its native CLI. Node.js must be available on PATH.
2. Enable **DeepSeek Harness** in Claudian Plus settings. Leave the CLI path empty for discovery, or select the npm `dsh.cmd`/`dsh.ps1` shim or its JavaScript entry. The Desktop executable is not supported.
3. Optionally set `DSH_HOME` in the provider environment, then refresh the native model catalog and open a new DeepSeek conversation.

The model menu uses names from the native catalog. After refreshing, the native default option also shows its concrete model name with a Harness default suffix; it continues to follow the native default rather than pinning that model. Refresh again after changing the default in Harness. If the catalog does not identify an available default, the option retains its generic label.

## Profiles and the Desktop app

The provider boots the npm CLI with `--profile web`, so the model menu reflects `$DSH_HOME/profiles/web` (its `llm-pi-ai`/provider plugins and credentials). The Desktop app boots its own `desktop` profile; providers configured inside the Desktop app — including subscription routes such as `opencode-go` — do not appear here until the web profile declares them too. Add the provider to the web profile's `cordis.patch.yml` (or configure it through `dsh web`), then refresh the catalog. Profiles share `$DSH_HOME` credentials but not provider configuration.

The npm CLI and the Desktop app are independent installs and can differ in version and shipped provider catalog. The model menu follows the npm CLI that the plugin launches, not the Desktop runtime.

The provider is disabled by default. Rendering settings does not start Harness. A workspace shares one native Web-profile process across tabs; tabs claim separate sessions. Startup may take tens of seconds. After changing environment or CLI configuration, close DeepSeek tabs and allow the idle Host to stop, or reload the plugin.

## Supported baseline

- Text and reasoning streams, tool calls and results, one-shot tool approval, explicit Stop.
- Native model selection and provider-advertised reasoning efforts.
- Native session binding, durable history pagination, and process-restart resume.
- Existing Obsidian note, selection and ambient text context.

Images, fork, rewind, steering, provider commands, shared MCP/skill management and autonomous background/subagent UI are not exposed. Local title generation does not spend model credits. Unknown context capacity is not invented or reported as token usage.

## Ownership and recovery

Credentials, profiles and session files remain native Harness data. Invocation overlays and the endpoint bootstrap file are generated in a private temporary directory. The invocation disables automatic LLM session titles and browser opening, and registers a small `claudian-plus` preset using official filesystem and shell tools. The plugin never edits the user's native profile or credentials.

Each saved session records its native home and preset. Legacy ACP conversations are retained and cannot silently attach to a new native session. Removing a local conversation does not delete native history. Switching native homes requires restoring the original home to resume an existing session.

Carrier loss ends the displayed query without replaying the prompt or cancelling native work. The next operation may reconnect; use Stop explicitly when cancellation is intended. A streamed attempt that is replaced cannot be retracted through the shared append-only renderer, so this integration ends that display and asks the user to reopen committed native history.

## Verification

Validated locally against official CLI `0.2.0-rc.2` on Windows. Automated tests use deterministic local HTTP/WS peers. Isolated native-process probes cover streaming, tools, approval, Stop, durable history and resume after restarting the Host, without calling an external model. The shipped runtime also completes streaming against an isolated native Harness inside Obsidian's Electron renderer. Real-account completions and visual acceptance remain separate checks.

The production build pins the Node `ws` entry. Its browser entry is a throwing placeholder and cannot authenticate native socket connections. `scripts/nodeWebSocket.test.mjs` verifies the actual browser-targeted bundle with real authenticated loopback HTTP and WebSocket peers.
