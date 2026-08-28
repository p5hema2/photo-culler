/**
 * Also pulls `window.d.ts` into the program, which is the only way its
 * `declare global { interface Window }` augmentation reaches a consumer.
 *
 * An editor loads every file in the package and so applied it anyway; `tsc`
 * loads only what the program references, so without this line every
 * `window.api` in the renderer reported TS2339 the moment typechecking became
 * real. Keep the re-export even if nothing imports MenuEvents by name.
 */
export type { MenuEvents } from './window';

export { IPC_CHANNELS, MENU_COMMANDS } from './ipc';
export type {
  ElectronAPI,
  FileOpResult,
  SessionConfig,
  ImageResult,
  QualitySubscores,
  ResultsFile,
  MenuCommand,
  RotateDirection,
  RotateResult,
  ScanProgress,
  ThumbSource,
  ThumbSourceFallback,
} from './ipc';
export type { ImageFileInfo } from './image';
export type {
  FocusVendor,
  FocusModeKind,
  FocusFrame,
  FocusRegionKind,
  NormRect,
  FocusRegion,
  FocusInfo,
  LensInfo,
  MetadataTag,
  DetailedMetadata,
} from './focus';
