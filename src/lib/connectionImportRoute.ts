export type ConnectionImportRouteSignals = {
  importInProgress: boolean;
  attentionCount?: number | null;
};

/**
 * The question queue is useful only while it can show live progress or work
 * that still needs attention. A latched presentation kind is not enough.
 */
export function shouldOpenImportQuestionQueue({
  importInProgress,
  attentionCount,
}: ConnectionImportRouteSignals): boolean {
  return importInProgress || Number(attentionCount ?? 0) > 0;
}
