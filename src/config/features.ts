export const ENABLE_DOC_MODES: boolean =
  process.env.EXPO_PUBLIC_ENABLE_DOC_MODES === 'true';

// Demo/test mode for the import flow. When true, the final commit is NOT sent to
// the backend: submitImport skips the real POST and routes straight to the
// completion screen with real-derived counts, and the draft autosaves are muted.
// Everything else (reading real DB data, the deck, the optimizer, field edits)
// stays real, so the whole match → optimize → completion flow can be walked
// end-to-end without going live on any marketplace. Off = real submits.
export const IMPORT_DEMO: boolean =
  process.env.EXPO_PUBLIC_IMPORT_DEMO === 'true';




