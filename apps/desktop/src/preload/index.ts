import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { ElectronAPI } from '@photo-culler/types';

const api: ElectronAPI = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
  scanFolder: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, folderPath),
  trashFiles: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.TRASH_FILES, filePaths),
  saveResults: (folderPath, data) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_RESULTS, folderPath, data),
  loadResults: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.LOAD_RESULTS, folderPath),
  getSession: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SESSION),
  setSession: (config) => ipcRenderer.invoke(IPC_CHANNELS.SET_SESSION, config),
  moveToPicks: (folderPath, filePaths) =>
    ipcRenderer.invoke(IPC_CHANNELS.MOVE_TO_PICKS, folderPath, filePaths),
  deleteFiles: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_FILES, filePaths),
  readFile: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.READ_FILE, filePath),
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
});
