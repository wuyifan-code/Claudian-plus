# Independent DeepSeek Harness Provider

This module adapts official native Harness HTTP/mux protocols to the existing ChatRuntime contract. Keep implementation independent from Claudian upstream code.

- The workspace Host owns one process, transport and session claims. A tab owns only its lease and conversation.
- Preserve user profiles, credentials and native sessions. Add only invocation-scoped overlays in owned temporary directories.
- Cold history is separate from live following. Resume alone does not prove history replay.
- Close stdin and await native shutdown before forced process termination on Windows.
- Transport loss never implies permission to cancel native work. Only explicit Stop or conversation disposal may cancel owned work.
- Validate saved native home identity; legacy ACP state must never be silently attached to a Web session.
- Initial release excludes images, forks, steering, autonomous background work and subagent UI.
- Tests use local deterministic peers or isolated DSH_HOME with a mock model. Never spend account credits in automated tests.
- Verify the shipped renderer bundle, not only Node-targeted probes. The browser-targeted build must pin the Node `ws` entry for authenticated native sockets; `scripts/nodeWebSocket.test.mjs` covers this boundary.
