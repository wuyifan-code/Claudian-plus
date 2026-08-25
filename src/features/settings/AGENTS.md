# Settings Feature

`src/features/settings/` owns the settings tab interface for Claudian Plus.

## Architecture

- `ClaudianPlusSettings.ts`: The main `PluginSettingTab` implementation using an Obsidian-style two-column shell (left category tree, right content pane).
- `settingsTree.ts`: Pure tree model defining top-level categories (`general`, `appearance`, `memory`, `providers`, `agents-skills`, `workspace`, `advanced`) and dynamically nesting enabled providers as subpages.
- `settingsSearch.ts`: In-memory substring search indexing registered setting names and descriptions for quick navigation and jump-and-highlight.
- `WorkspaceResourcesSettings.ts`: Skills, subagents, and MCP configuration interface.
- `AgentSkillManagementCoordinator.ts`: State management and notifications for agent skills.

## Provider Boundary

- Provider settings are rendered as subpages under `providers:<providerId>`.
- Provider tabs are discovered and rendered via `ProviderWorkspaceRegistry.getSettingsTabRenderer(providerId)` without hardcoding provider UI details into the settings shell.
