import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

export function buildDshRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'dsh');
  const envVars = parseEnvironmentVariables(envText);
  return {
    ...process.env,
    ...envVars,
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
