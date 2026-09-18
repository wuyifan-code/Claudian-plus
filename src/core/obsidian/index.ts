export type {
  Box,
  CanvasNeighborWritePlanOptions,
  CanvasNeighborWritePlanResult,
} from './canvasNeighborPlan';
export {
  buildCanvasNeighborWritePlan,
  checkAABBCollision,
  findNonCollidingSlot,
} from './canvasNeighborPlan';
export type {
  CanvasWriteCommitResult,
  CanvasWriteUndoResult,
} from './CanvasWriteHistory';
export {
  CanvasWriteHistory,
  commitCanvasWrite,
  getCanvasWriteHistory,
  undoLastCanvasWrite,
} from './CanvasWriteHistory';
export type {
  ObsidianGraphNeighbor,
  ObsidianLinkSource,
  ObsidianLinksResult,
  ObsidianLinkTarget,
} from './links';
export { buildObsidianGraphNeighbors, buildObsidianLinks } from './links';
export type {
  CanvasData,
  CanvasEdge,
  CanvasEdgeOperation,
  CanvasNode,
  CanvasNodeOperation,
  CanvasReadResult,
  CanvasWritePlan,
  FrontmatterRecord,
  PropertiesReadResult,
  PropertiesSetOperation,
} from './ObsidianContextService';
export {
  applyCanvasWritePlan,
  commitCanvasWritePlan,
  diffCanvasWritePlan,
  diffPropertiesWrite,
  readCanvas,
  readProperties,
  serializeCanvasData,
  writeProperties,
} from './ObsidianContextService';
export type {
  ObsidianToolBridgeError,
  ObsidianToolBridgeHandle,
  ObsidianToolBridgeRequest,
  ObsidianToolBridgeResponse,
  ObsidianToolBridgeSuccess,
} from './ObsidianToolBridge';
export { ObsidianToolBridge } from './ObsidianToolBridge';
export type {
  VaultSearchNoteResult,
  VaultSearchOptions,
  VaultSearchResponse,
} from './vaultSearch';
export { searchVaultNotes } from './vaultSearch';
