import { t } from '../../../i18n/i18n';
import {
  TriggerModeManager,
  type TriggerModeManagerCallbacks,
} from './TriggerModeManager';

export type BangBashModeCallbacks = TriggerModeManagerCallbacks;

export interface BangBashModeState {
  active: boolean;
  rawCommand: string;
}

export class BangBashModeManager extends TriggerModeManager {
  constructor(
    inputEl: HTMLTextAreaElement,
    callbacks: BangBashModeCallbacks,
  ) {
    super(inputEl, callbacks, {
      triggerKey: '!',
      modeClass: 'claudian-plus-input-bang-bash-mode',
      placeholder: t('chat.bangBash.placeholder'),
      blockEmptySubmit: true,
      clearBeforeSubmit: true,
      showSubmitError: true,
    });
  }

  getRawCommand(): string {
    return this.getRawText();
  }
}
