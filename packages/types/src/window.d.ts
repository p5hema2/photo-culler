import type { ElectronAPI } from './ipc';

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
