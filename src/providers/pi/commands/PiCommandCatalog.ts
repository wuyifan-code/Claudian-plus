import { createRuntimeOnlyCommandCatalogClass } from '../../../core/providers/commands/RuntimeOnlyCommandCatalog';

export const PiCommandCatalog = createRuntimeOnlyCommandCatalogClass({
  providerId: 'pi',
  displayName: 'Pi',
  preserveCommandKind: true,
});
