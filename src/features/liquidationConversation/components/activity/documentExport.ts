// documentExport — serialize an agent-authored report to Markdown, and copy / share /
// save it as a file. Markdown is the portable format; "Save as file" writes a .md and
// hands it to the OS sheet (Files, Mail, Print → PDF, etc.); "Share" shares the text.
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import type { DocumentSection, ReportDocument } from '../../types';

function sectionToMarkdown(s: DocumentSection): string {
  const heading = s.heading ? `## ${s.heading}\n\n` : '';
  if (s.kind === 'prose') return `${heading}${s.text}`;
  if (s.kind === 'metrics') {
    const rows = s.metrics
      .map((m) => `- **${m.label}:** ${m.value}${m.sub ? ` _(${m.sub})_` : ''}`)
      .join('\n');
    return `${heading}${rows}`;
  }
  // table
  const cols = s.columns.length ? s.columns : (s.rows[0] || []).map((_, i) => `Col ${i + 1}`);
  const header = `| ${cols.join(' | ')} |`;
  const sep = `| ${cols.map(() => '---').join(' | ')} |`;
  const body = s.rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return `${heading}${header}\n${sep}\n${body}`;
}

export function documentToMarkdown(doc: ReportDocument): string {
  const head = `# ${doc.title}\n\n${doc.summary ? `_${doc.summary}_\n\n` : ''}`;
  const body = (doc.sections || []).map(sectionToMarkdown).join('\n\n');
  return `${head}${body}\n`;
}

// A filesystem-safe basename from the report title.
function safeFileName(title: string): string {
  const base = (title || 'report').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return base || 'report';
}

// These operate on the CURRENT markdown (which may include the seller's edits), so the
// tray passes its live draft rather than re-deriving from the original document.
export async function copyMarkdown(markdown: string): Promise<void> {
  await Clipboard.setStringAsync(markdown);
}

export async function shareMarkdown(title: string, markdown: string): Promise<void> {
  await Share.share({ title, message: markdown });
}

// Write the markdown to a .md file and present the OS sheet (Save to Files, Mail,
// Print → Save as PDF, …). Falls back to a plain text share if file sharing is off.
export async function saveMarkdownFile(title: string, markdown: string): Promise<void> {
  try {
    const uri = `${FileSystem.cacheDirectory}${safeFileName(title)}.md`;
    await FileSystem.writeAsStringAsync(uri, markdown, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'text/markdown',
        dialogTitle: title,
        UTI: 'net.daringfireball.markdown',
      });
      return;
    }
  } catch {
    /* fall through to a text share */
  }
  await Share.share({ title, message: markdown }).catch(() => undefined);
}

// ── CSV export (the spreadsheet path) ──────────────────────────────────────
// Serializes the report's table + metrics sections to CSV so a report opens
// straight into Numbers / Sheets / Excel. Prose sections are skipped: CSV is
// for the data, the .md export carries the words.

function csvCell(value: string): string {
  let v = String(value ?? '');
  // Neutralize CSV formula injection: a leading = + - @ would execute as a
  // formula in Excel/Sheets. The apostrophe marks the cell as text.
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** True when the document has at least one table or metrics section to export. */
export function documentHasTabularData(doc: ReportDocument): boolean {
  return (doc.sections || []).some((s) => s.kind === 'table' || s.kind === 'metrics');
}

export function documentToCsv(doc: ReportDocument): string {
  const blocks: string[] = [];
  for (const s of doc.sections || []) {
    if (s.kind === 'table') {
      const cols = s.columns.length ? s.columns : (s.rows[0] || []).map((_, i) => `Col ${i + 1}`);
      const lines = [
        ...(s.heading ? [csvCell(s.heading)] : []),
        cols.map(csvCell).join(','),
        ...s.rows.map((r) => r.map(csvCell).join(',')),
      ];
      blocks.push(lines.join('\n'));
    } else if (s.kind === 'metrics') {
      const lines = [
        ...(s.heading ? [csvCell(s.heading)] : []),
        'Label,Value,Note',
        ...s.metrics.map((m) => [m.label, m.value, m.sub || ''].map(csvCell).join(',')),
      ];
      blocks.push(lines.join('\n'));
    }
  }
  return blocks.join('\n\n') + '\n';
}

// Write the report's tabular data to a .csv and present the OS sheet.
export async function saveCsvFile(title: string, doc: ReportDocument): Promise<void> {
  const csv = documentToCsv(doc);
  try {
    const uri = `${FileSystem.cacheDirectory}${safeFileName(title)}.csv`;
    await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: title,
        UTI: 'public.comma-separated-values-text',
      });
      return;
    }
  } catch {
    /* fall through to a text share */
  }
  await Share.share({ title, message: csv }).catch(() => undefined);
}
