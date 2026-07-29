import { Setting } from 'obsidian';

import { getEnvironmentReviewKeysForScope } from '../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../core/providers/ProviderHost';
import type { EnvironmentScope } from '../../core/types/settings';
import { localeText } from '../../i18n/i18n';
import { EnvSnippetManager } from './EnvSnippetManager';

interface EnvironmentSettingsSectionOptions {
  container: HTMLElement;
  plugin: ProviderHost;
  scope: EnvironmentScope;
  heading?: string;
  name: string;
  desc: string;
  placeholder: string;
  renderCustomContextLimits?: (container: HTMLElement) => void;
}

export function renderEnvironmentSettingsSection(
  options: EnvironmentSettingsSectionOptions,
): void {
  const {
    container,
    plugin,
    scope,
    heading,
    name,
    desc,
    placeholder,
    renderCustomContextLimits,
  } = options;

  if (heading) {
    new Setting(container).setName(heading).setHeading();
  }

  let envTextarea: HTMLTextAreaElement | null = null;
  const reviewEl = container.createDiv({
    cls: 'claudian-plus-env-review-warning claudian-plus-setting-validation claudian-plus-setting-validation-warning claudian-plus-hidden',
  });

  const updateReviewWarning = () => {
    const reviewKeys = getEnvironmentReviewKeysForScope(envTextarea?.value ?? '', scope);
    if (reviewKeys.length === 0) {
      reviewEl.toggleClass('claudian-plus-hidden', true);
      reviewEl.empty();
      return;
    }

    reviewEl.setText(localeText(`请检查以下环境变量的归属：${reviewKeys.join('、')}`, `Review environment ownership for: ${reviewKeys.join(', ')}`));
    reviewEl.toggleClass('claudian-plus-hidden', false);
  };

  new Setting(container)
    .setName(name)
    .setDesc(desc)
    .addTextArea((text) => {
      text
        .setPlaceholder(placeholder)
        .setValue(plugin.getEnvironmentVariablesForScope(scope));
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addClass('claudian-plus-settings-env-textarea');
      text.inputEl.dataset.envScope = scope;
      text.inputEl.addEventListener('input', () => updateReviewWarning());
      text.inputEl.addEventListener('blur', () => {
        void (async (): Promise<void> => {
          await plugin.applyEnvironmentVariables(scope, text.inputEl.value);
          renderCustomContextLimits?.(contextLimitsContainer);
          updateReviewWarning();
        })();
      });
      envTextarea = text.inputEl;
    });

  updateReviewWarning();

  const contextLimitsContainer = container.createDiv({ cls: 'claudian-plus-context-limits-container' });
  renderCustomContextLimits?.(contextLimitsContainer);

  const envSnippetsContainer = container.createDiv({ cls: 'claudian-plus-env-snippets-container' });
  new EnvSnippetManager(envSnippetsContainer, plugin, scope, () => {
    renderCustomContextLimits?.(contextLimitsContainer);
  });
}
