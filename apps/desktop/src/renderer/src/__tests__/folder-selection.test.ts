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
        folder: '/Users/test/photos',
        extension: 'jpg',
        size: 1024000,
        lastModified: Date.now(),
      },
      {
        path: '/Users/test/photos/IMG_002.jpg',
        name: 'IMG_002.jpg',
        folder: '/Users/test/photos',
        extension: 'jpg',
        size: 2048000,
        lastModified: Date.now(),
      },
    ];

    vi.mocked(mockApi.scanFolder!).mockResolvedValue({
      images: mockImages,
      directories: ['/Users/test/photos'],
    });

    const result = await mockApi.scanFolder!('/Users/test/photos');
    expect(result.images).toHaveLength(2);
    expect(result.images[0]!.name).toBe('IMG_001.jpg');
    expect(result.images[1]!.extension).toBe('jpg');
    // A scan reports directories as well as images since 1.8.1 — the tree needs
    // the ones that hold no photos.
    expect(result.directories).toEqual(['/Users/test/photos']);
  });

  it('scanFolder still reports the folder itself when it holds no images', async () => {
    vi.mocked(mockApi.scanFolder!).mockResolvedValue({
      images: [],
      directories: ['/Users/test/empty'],
    });

    const result = await mockApi.scanFolder!('/Users/test/empty');
    expect(result.images).toEqual([]);
    expect(result.directories).toEqual(['/Users/test/empty']);
  });

  it('select then scan flow works in sequence', async () => {
    vi.mocked(mockApi.selectFolder!).mockResolvedValue('/Users/test/photos');
    vi.mocked(mockApi.scanFolder!).mockResolvedValue({
      images: [
        {
          path: '/Users/test/photos/IMG_001.jpg',
          name: 'IMG_001.jpg',
          folder: '/Users/test/photos',
          extension: 'jpg',
          size: 1024000,
          lastModified: Date.now(),
        },
      ],
      directories: ['/Users/test/photos'],
    });

    const folderPath = await mockApi.selectFolder!();
    expect(folderPath).toBe('/Users/test/photos');

    const scanned = await mockApi.scanFolder!(folderPath!);
    expect(scanned.images).toHaveLength(1);
    expect(mockApi.scanFolder).toHaveBeenCalledWith('/Users/test/photos');
  });
});
