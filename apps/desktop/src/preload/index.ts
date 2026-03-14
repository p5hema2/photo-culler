import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@photo-culler/types';
import type { ElectronAPI } from '@photo-culler/types';

const api: ElectronAPI = {
  selectFolder: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_FOLDER),
  scanFolder: (folderPath) => ipcRenderer.invoke(IPC_CHANNELS.SCAN_FOLDER, folderPath),
  trashFiles: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.TRASH_FILES, filePaths),
};

contextBridge.exposeInMainWorld('api', api);
