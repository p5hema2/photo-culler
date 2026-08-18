import type { ElectronAPI, MenuCommand } from './ipc';

export interface MenuEvents {
  onOpenFolder: (callback: (folderPath: string) => void) => void;
  removeOpenFolderListener: () => void;
  /** Menu items that map to a renderer action rather than carrying a payload. */
  onCommand: (callback: (command: MenuCommand) => void) => void;
  removeCommandListener: () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
    menuEvents: MenuEvents;
  }
}
