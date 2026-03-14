export interface ImageFileInfo {
  /** Absolute path to the image file */
  path: string;
  /** File name with extension (e.g., "IMG_1234.jpg") */
  name: string;
  /** File extension without dot, lowercase (e.g., "jpg") */
  extension: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp (ms since epoch) */
  lastModified: number;
  /** Image width in pixels (available after metadata extraction) */
  width?: number;
  /** Image height in pixels (available after metadata extraction) */
  height?: number;
}
