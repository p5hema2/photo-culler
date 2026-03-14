import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImageFileInfo, ElectronAPI } from '@photo-culler/types';

// Mock window.api
const mockApi: Partial<ElectronAPI> = {
  selectFolder: vi.fn(),
  scanFolder: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { window: { api: Partial<ElectronAPI> } }).window = {
    api: mockApi,
  };
});

describe('folder selection IPC flow', () => {
  it('selectFolder returns a folder path', async () => {
    vi.mocked(mockApi.selectFolder!).mockResolvedValue('/Users/test/photos');

    const result = await mockApi.selectFolder!();
    expect(result).toBe('/Users/test/photos');
  });

  it('selectFolder returns null when cancelled', async () => {
    vi.mocked(mockApi.selectFolder!).mockResolvedValue(null);

    const result = await mockApi.selectFolder!();
    expect(result).toBeNull();
  });

  it('scanFolder returns ImageFileInfo[] for a valid path', async () => {
    const mockImages: ImageFileInfo[] = [
      {
        path: '/Users/test/photos/IMG_001.jpg',
        name: 'IMG_001.jpg',
        extension: 'jpg',
        size: 1024000,
        lastModified: Date.now(),
      },
      {
        path: '/Users/test/photos/IMG_002.jpg',
        name: 'IMG_002.jpg',
        extension: 'jpg',
        size: 2048000,
        lastModified: Date.now(),
      },
    ];

    vi.mocked(mockApi.scanFolder!).mockResolvedValue(mockImages);

    const result = await mockApi.scanFolder!('/Users/test/photos');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('IMG_001.jpg');
    expect(result[1].extension).toBe('jpg');
  });

  it('scanFolder returns empty array for folder with no images', async () => {
    vi.mocked(mockApi.scanFolder!).mockResolvedValue([]);

    const result = await mockApi.scanFolder!('/Users/test/empty');
    expect(result).toEqual([]);
  });

  it('select then scan flow works in sequence', async () => {
    vi.mocked(mockApi.selectFolder!).mockResolvedValue('/Users/test/photos');
    vi.mocked(mockApi.scanFolder!).mockResolvedValue([
      {
        path: '/Users/test/photos/IMG_001.jpg',
        name: 'IMG_001.jpg',
        extension: 'jpg',
        size: 1024000,
        lastModified: Date.now(),
      },
    ]);

    const folderPath = await mockApi.selectFolder!();
    expect(folderPath).toBe('/Users/test/photos');

    const images = await mockApi.scanFolder!(folderPath!);
    expect(images).toHaveLength(1);
    expect(mockApi.scanFolder).toHaveBeenCalledWith('/Users/test/photos');
  });
});
