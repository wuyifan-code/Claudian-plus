import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { decodeDshModelId } from '../models';
import { DshAuxQueryRunner } from '../runtime/DshAuxQueryRunner';
import { dshChatUIConfig } from '../ui/DshChatUIConfig';

export class DshTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ProviderHost) {
    super({
      createRunner: () => new DshAuxQueryRunner(plugin),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!dshChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeDshModelId(titleModel) ?? undefined;
      },
    });
  }
}
