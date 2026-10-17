import { buildLocalFallbackTitle } from '../../../core/auxiliary/AuxiliaryRequestPolicy';
import type { TitleGenerationCallback, TitleGenerationService } from '../../../core/providers/types';

export class DshTitleGenerationService implements TitleGenerationService {
  async generateTitle(id: string, message: string, callback: TitleGenerationCallback): Promise<void> {
    await callback(id, { success: true, title: buildLocalFallbackTitle(message) });
  }

  cancel(): void {}
}
