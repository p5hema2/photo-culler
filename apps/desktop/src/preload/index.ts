import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { ElectronAPI, MenuCommand, ScanProgress } from '@photo-culler/types';

const api: ElectronAPI = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
  scanFolder: (folderPath, scanId) =>
    ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, folderPath, scanId),
  onScanProgress: (listener) => {
    ipcRenderer.on(IPC_CHANNELS.SCAN_PROGRESS, (_event, progress: ScanProgress) =>
      listener(progress),
    );
  },
  // removeAllListeners is the unsubscribe because there is exactly one
  // subscriber — the photo store, once per mount. Same arrangement as the menu
  // events below.
  removeScanProgressListener: () => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.SCAN_PROGRESS);
  },
  saveResults: (folderPath, data) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_RESULTS, folderPath, data),
  loadResults: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.LOAD_RESULTS, folderPath),
  clearResults: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_RESULTS, folderPath),
  getSession: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION),
  setSession: (config) => ipcRenderer.invoke(IPC_CHANNELS.SET_SESSION, config),
  deleteFiles: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_FILES, filePaths),
  readFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE, filePath),
  readThumbSource: (filePath, minEdge) =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_THUMB_SOURCE, filePath, minEdge),
  loadThumbCache: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.LOAD_THUMB_CACHE, filePath),
  saveThumbCache: (filePath, thumbBuffer) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_THUMB_CACHE, filePath, thumbBuffer),
  rotateImage: (filePath, direction) =>
    ipcRenderer.invoke(IPC_CHANNELS.ROTATE_IMAGE, filePath, direction),
  writeRating: (filePath, rating) =>
    ipcRenderer.invoke(IPC_CHANNELS.WRITE_RATING, filePath, rating),
  readDetailedMetadata: (filePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_DETAILED_METADATA, filePath),
  cleanUpFolder: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.CLEAN_UP_FOLDER, folderPath),
  countThumbCache: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.COUNT_THUMB_CACHE, folderPath),
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.GET_APP_VERSION),
};

contextBridge.exposeInMainWorld('api', api);

// Menu events from main process
contextBridge.exposeInMainWorld('menuEvents', {
  onOpenFolder: (callback: (folderPath: string) => void) => {
    ipcRenderer.on('menu:open-folder', (_event, folderPath: string) => callback(folderPath));
  },
  removeOpenFolderListener: () => {
    ipcRenderer.removeAllListeners('menu:open-folder');
  },
  onCommand: (callback: (command: MenuCommand) => void) => {
    ipcRenderer.on('menu:command', (_event, command: MenuCommand) => callback(command));
  },
  removeCommandListener: () => {
    ipcRenderer.removeAllListeners('menu:command');
  },
});
