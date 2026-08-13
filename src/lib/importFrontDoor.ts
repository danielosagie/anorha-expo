export interface ImportFrontDoorSummary {
  autoLinked: number;
  autoCreated: number;
  skipped: number;
  needsAttention: number;
}

export type ImportFrontDoorRowKind = 'linked' | 'added' | 'skipped' | 'needsLook';

export interface ImportFrontDoorRow {
  kind: ImportFrontDoorRowKind;
  label: string;
  count: number;
}

export function buildImportFrontDoorRows(
  summary?: ImportFrontDoorSummary | null,
): ImportFrontDoorRow[] {
  const rows: ImportFrontDoorRow[] = [
    { kind: 'linked', label: 'Linked', count: summary?.autoLinked ?? 0 },
    { kind: 'added', label: 'Added', count: summary?.autoCreated ?? 0 },
  ];

  if ((summary?.skipped ?? 0) > 0) {
    rows.push({ kind: 'skipped', label: 'Skipped', count: summary?.skipped ?? 0 });
  }
  if ((summary?.needsAttention ?? 0) > 0) {
    rows.push({ kind: 'needsLook', label: 'NEEDS A LOOK', count: summary?.needsAttention ?? 0 });
  }

  return rows;
}

export function importFrontDoorAction(questionCount: number): {
  label: string;
  opensQuestions: boolean;
  showLater: boolean;
} {
  if (questionCount < 1) {
    return { label: 'Done', opensQuestions: false, showLater: false };
  }
  return {
    label: `${questionCount} more ${questionCount === 1 ? 'question' : 'questions'}`,
    opensQuestions: true,
    showLater: true,
  };
}
