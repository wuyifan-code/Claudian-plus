import {
  TriggerModeManager,
  type TriggerModeManagerCallbacks,
} from './TriggerModeManager';

export type InstructionModeCallbacks = TriggerModeManagerCallbacks;

export interface InstructionModeState {
  active: boolean;
  rawInstruction: string;
}

const INSTRUCTION_MODE_PLACEHOLDER = '# Save in custom system prompt';

export class InstructionModeManager extends TriggerModeManager {
  constructor(
    inputEl: HTMLTextAreaElement,
    callbacks: InstructionModeCallbacks,
  ) {
    super(inputEl, callbacks, {
      triggerKey: '#',
      modeClass: 'claudian-plus-input-instruction-mode',
      placeholder: INSTRUCTION_MODE_PLACEHOLDER,
      autoExitOnEmpty: true,
    });
  }

  getRawInstruction(): string {
    return this.getRawText();
  }
}
