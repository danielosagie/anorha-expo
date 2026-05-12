/**
 * RGB color tuple [0-1, 0-1, 0-1] or [0-255, 0-255, 0-255]
 */
export type RGB = [number, number, number];
/**
 * Flexible color input
 */
export type ColorValue = RGB | string;
/**
 * Converts a hex color string to normalized RGB [0-1]
 * Supports formats: "#RGB", "#RRGGBB", "RGB", "RRGGBB"
 *
 */
export declare function hex(hexColor: string): RGB;
/**
 * Creates a normalized RGB color from 0-255 values
 */
export declare function rgb(r: number, g: number, b: number): RGB;
/**
 * Normalizes any supported color format to [0-1] RGB
 */
export declare function normalizeColor(color: ColorValue): RGB;
//# sourceMappingURL=color.d.ts.map