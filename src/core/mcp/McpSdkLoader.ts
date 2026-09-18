/**
 * The MCP SDK is externalized in the bundle, and the installed plugin folder ships
 * only main.js, manifest.json, and styles.css, so the package cannot be resolved at
 * runtime. Every SDK value must therefore be loaded with `await import(...)` inside
 * the code path that needs it and routed through this helper, so a missing module
 * degrades that one feature with an actionable message instead of breaking plugin
 * load with a top-level require.
 */
export async function loadMcpSdkValue<T>(feature: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The MCP SDK is not bundled in this build, so ${feature} is unavailable. (${detail})`,
      { cause: error },
    );
  }
}
