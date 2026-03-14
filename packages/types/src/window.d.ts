import type { ElectronAPI } from './ipc';

export interface MenuEvents {
  onOpenFolder: (callback: (folderPath: string) => void) => void;
  removeOpenFolderListener: () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
    menuEvents: MenuEvents;
  }
}
