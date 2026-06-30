// useImportSession — REMOVED.
//
// This hook drove the legacy client-side import/review deck (MappingReview +
// ImportOverview), talking directly to the legacy backend endpoints
// (mapping-suggestions / import-draft / confirm-mappings / draft-mappings /
// missing-mappings) and running the client matching brain. Connect→sync now
// resolves server-side: platform scans and CSV imports both persist
// mappingSuggestions on the connection, and the app reads the resolver's
// buckets through the async Sync Inbox (useResolution → GET /resolution,
// POST /resolve). The deck, its matching brain, and this hook are gone.
//
// Only the storage key survives: useImportProgress still reads it to surface a
// resumable in-flight import banner. Nothing writes it anymore, so the banner
// stays inert until a future flow opts back in.
export const LAST_IMPORT_STORAGE_KEY = 'anorha:lastImport';
