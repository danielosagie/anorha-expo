// PLATFORM_META is derived from the canonical platform registry
// (src/config/platforms.ts). Kept as a named export so existing importers
// (PublishConfirmationModal, GenerateDetailsScreen) keep working unchanged.
// Do NOT re-declare a per-platform label/icon map here — add platforms to the
// registry instead.
export { PLATFORM_CONFIG as PLATFORM_META } from '../config/platforms';
