import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { DshAuxQueryRunner } from '../runtime/DshAuxQueryRunner';

export class DshInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ProviderHost) {
    super(new DshAuxQueryRunner(plugin));
  }
}
