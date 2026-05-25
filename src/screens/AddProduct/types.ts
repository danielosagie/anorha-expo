// Shared types for the AddProduct feature (extracted from AddProductScreen.tsx).

export type CameraMode = 'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf';

export type UnicodeSpinnerDefinition = {
  frames: string[];
  interval: number;
};
