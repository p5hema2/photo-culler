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
  /** EXIF DateTimeOriginal timestamp (ms since epoch), if available */
  dateTaken?: number;
  /** Image width in pixels (available after metadata extraction) */
  width?: number;
  /** Image height in pixels (available after metadata extraction) */
  height?: number;
  /** Camera make (e.g., "Canon", "Nikon") */
  cameraMake?: string;
  /** Camera model (e.g., "EOS R5", "Z6 III") */
  cameraModel?: string;
  /** Lens model (e.g., "RF 24-70mm F2.8 L IS USM") */
  lensModel?: string;
  /** Focal length in mm (e.g., 50) */
  focalLength?: number;
  /** Aperture f-number (e.g., 2.8) */
  aperture?: number;
  /** Shutter speed as a string (e.g., "1/250", "2") */
  shutterSpeed?: string;
  /** ISO sensitivity (e.g., 800) */
  iso?: number;
  /** Exposure compensation in EV (e.g., -0.7, +1.0) */
  exposureCompensation?: number;
  /** Flash fired or not */
  flash?: string;
  /** White balance mode */
  whiteBalance?: string;
  /** Metering mode (e.g., "Multi-segment", "Center-weighted") */
  meteringMode?: string;
  /** Exposure program (e.g., "Aperture Priority", "Manual") */
  exposureProgram?: string;
  /** Color space (e.g., "sRGB", "Adobe RGB") */
  colorSpace?: string;
}
