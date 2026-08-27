import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { ElectronAPI, MenuCommand } from '@photo-culler/types';

const api: ElectronAPI = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
  scanFolder: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, folderPath),
  saveResults: (folderPath, data) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_RESULTS, folderPath, data),
  loadResults: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.LOAD_RESULTS, folderPath),
  clearResults: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_RESULTS, folderPath),
  getSession: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION),
  setSession: (config) => ipcRenderer.invoke(IPC_CHANNELS.SET_SESSION, config),
  deleteFiles: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_FILES, filePaths),
  readFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE, filePath),
  loadThumbCache: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.LOAD_THUMB_CACHE, filePath),
  saveThumbCache: (filePath, thumbBuffer) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_THUMB_CACHE, filePath, thumbBuffer),
  rotateFiles: (files) => ipcRenderer.invoke(IPC_CHANNELS.ROTATE_FILES, files),
  writeRating: (filePath, rating) =>
    ipcRenderer.invoke(IPC_CHANNELS.WRITE_RATING, filePath, rating),
  readDetailedMetadata: (filePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.READ_DETAILED_METADATA, filePath),
  cleanUpFolder: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.CLEAN_UP_FOLDER, folderPath),
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
