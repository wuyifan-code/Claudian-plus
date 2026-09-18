import { buildLocalFallbackTitle } from '../../../core/auxiliary/AuxiliaryRequestPolicy';
import type {
  TitleGenerationCallback,
  TitleGenerationService,
} from '../../../core/providers/types';

/**
 * Model-free title service for Antigravity.
 *
 * The provider has no verified auxiliary query path: the only A0-verified
 * invocation is a print-mode chat turn that would spend the user's own agy
 * account budget, and no lightweight runner exists to hide behind. Titles are
 * therefore derived locally from the first message, deterministically and with
 * zero model requests.
 *
 * Because it issues no request, it also never consults the saving-mode gate or
 * the shared background request budget: those exist to bound model calls, and
 * counting a local string operation as a background request would misreport it.
 */
export class AntigravityTitleGenerationService implements TitleGenerationService {
  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    await callback(conversationId, {
      success: true,
      title: buildLocalFallbackTitle(userMessage),
    });
  }

  cancel(): void {
    // Nothing is in flight, so there is nothing to cancel.
  }
}
