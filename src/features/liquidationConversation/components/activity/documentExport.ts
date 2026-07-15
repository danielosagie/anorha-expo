// documentExport — serialize an agent-authored report to Markdown, and copy / share /
// save it as a polished PDF. Share remains plain text for quick handoffs while Save
// creates the durable business document sellers expect.
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import type { DocumentSection, ReportDocument } from '../../types';
import { compactDisplayText, sanitizeDisplayText } from '../../displayText';

const SUMMARY_HEADING = /executive summary|summary|overview|at a glance|in short|what this means/i;
const PROBLEM_HEADING = /problem|issue|risk|friction|why it matters|what(?:'s| is) holding|opportunity|setup|situation|context|challenge/i;
const SOLUTION_HEADING = /solution|recommend|next move|next step|what to do|plan|approach|how to fix|action|honest take/i;
const DATA_HEADING = /data|evidence|numbers|breakdown|forecast|impact|result|analysis|support/i;
const ACCOUNT_HEALTH = /account health|health score|account score/i;
const ACTION_SENTENCE = /[.!?]\s+(?=(?:you (?:need|should|can)|start|begin|choose|use|focus|prioritize|activate|list|publish|send|open|the .{0,48} (?:is|are) the (?:best|easiest|cleanest)|we recommend|sprout recommends)\b)/i;

function isAccountHealthSection(section: DocumentSection): boolean {
  if (ACCOUNT_HEALTH.test(section.heading || '')) return true;
  return section.kind === 'metrics' && section.metrics.length > 0 && section.metrics.every((metric) => ACCOUNT_HEALTH.test(metric.label));
}

function reportSectionRank(section: DocumentSection): number {
  const heading = section.heading || '';
  if (section.kind === 'metrics' || section.kind === 'table') return 3;
  if (PROBLEM_HEADING.test(heading)) return 1;
  if (SOLUTION_HEADING.test(heading)) return 2;
  if (DATA_HEADING.test(heading)) return 3;
  return 4;
}

function normalizeReportSection(section: DocumentSection): DocumentSection {
  const heading = sanitizeDisplayText(section.heading);
  if (section.kind === 'prose') {
    const isProblem = PROBLEM_HEADING.test(section.heading || '');
    const isSolution = SOLUTION_HEADING.test(section.heading || '');
    const text = compactDisplayText(section.text, {
      maxChars: isSolution ? 560 : isProblem ? 480 : 620,
      maxSentences: isSolution ? 4 : isProblem ? 3 : 4,
    });
    return { ...section, heading, text };
  }
  if (section.kind === 'metrics') {
    return {
      ...section,
      heading,
      metrics: section.metrics.map((metric) => ({
        ...metric,
        label: sanitizeDisplayText(metric.label),
        value: sanitizeDisplayText(metric.value),
        sub: metric.sub ? sanitizeDisplayText(metric.sub) : metric.sub,
      })),
    };
  }
  return {
    ...section,
    heading,
    columns: section.columns.map(sanitizeDisplayText),
    rows: section.rows.map((row) => row.map(sanitizeDisplayText)),
  };
}

export function organizeReportDocument(document: ReportDocument): { overview: string; sections: DocumentSection[] } {
  let visible = (document.sections || []).filter((section) => !isAccountHealthSection(section));

  // Older reports occasionally put the diagnosis and prescription in one prose
  // block. When a clear action sentence begins partway through a problem section,
  // split it so the recommendation can sit before the supporting data.
  const alreadyHasSolution = visible.some(
    (section) => section.kind === 'prose' && SOLUTION_HEADING.test(section.heading || ''),
  );
  const mixedIndex = visible.findIndex(
    (section) => section.kind === 'prose' && PROBLEM_HEADING.test(section.heading || '') && ACTION_SENTENCE.test(section.text),
  );
  const mixed = visible[mixedIndex];
  if (mixedIndex >= 0 && mixed?.kind === 'prose') {
    const boundary = mixed.text.search(ACTION_SENTENCE);
    const solutionStart = boundary >= 0 ? boundary + 2 : -1;
    const problemText = mixed.text.slice(0, solutionStart).trim();
    const solutionText = mixed.text.slice(solutionStart).trim();
    if (problemText.length >= 40 && solutionText.length >= 30) {
      visible = [
        ...visible.slice(0, mixedIndex),
        { ...mixed, text: problemText },
        ...(alreadyHasSolution ? [] : [{ kind: 'prose' as const, heading: 'The solution', text: solutionText }]),
        ...visible.slice(mixedIndex + 1),
      ];
    }
  }
  const summarySections = visible.filter(
    (section): section is Extract<DocumentSection, { kind: 'prose' }> =>
      section.kind === 'prose' && SUMMARY_HEADING.test(section.heading || ''),
  );
  const overview = compactDisplayText(
    document.summary?.trim() || summarySections[0]?.text?.trim() || '',
    { maxChars: 220, maxSentences: 2 },
  );
  const summarySet = new Set<DocumentSection>(summarySections);
  const sections = visible
    .filter((section) => !summarySet.has(section))
    .map((section, index) => ({ section, index }))
    .sort((a, b) => reportSectionRank(a.section) - reportSectionRank(b.section) || a.index - b.index)
    .map(({ section }) => normalizeReportSection(section));

  return { overview, sections };
}

export function reportSectionHeading(section: DocumentSection): string | undefined {
  const heading = section.heading || '';
  if (section.kind === 'metrics' || section.kind === 'table') return section.heading || 'Supporting data';
  if (PROBLEM_HEADING.test(heading)) return 'The problem';
  if (SOLUTION_HEADING.test(heading)) return 'The solution';
  return sanitizeDisplayText(section.heading);
}

function sectionToMarkdown(s: DocumentSection): string {
  const displayHeading = reportSectionHeading(s);
  const heading = displayHeading ? `## ${displayHeading}\n\n` : '';
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
  const reading = organizeReportDocument(doc);
  const head = `# ${sanitizeDisplayText(doc.title)}\n\n${reading.overview ? `## What this means\n\n${reading.overview}\n\n` : ''}`;
  const body = reading.sections.map(sectionToMarkdown).join('\n\n');
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/_(.+?)_/g, '<em>$1</em>');
}

/** Small, deterministic Markdown renderer for the report shapes Anorha authors. */
function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];

  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) {
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inlineMarkdown(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length) {
        const row = lines[i].trim();
        if (!row.startsWith('|') || !row.endsWith('|')) break;
        const cells = row.slice(1, -1).split('|').map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) rows.push(cells);
        i += 1;
      }
      if (rows.length) {
        const [header, ...body] = rows;
        blocks.push(`<table><thead><tr>${header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      }
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || /^[-*]\s+/.test(next) || (next.startsWith('|') && next.endsWith('|'))) break;
      paragraph.push(next);
      i += 1;
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return blocks.join('\n');
}

function reportPdfHtml(markdown: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { margin: 48px 44px 54px; }
  * { box-sizing: border-box; }
  body { color: #18181b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.55; }
  h1 { font-size: 25px; line-height: 1.15; margin: 0 0 20px; letter-spacing: -0.4px; }
  h2 { font-size: 16px; line-height: 1.25; margin: 24px 0 8px; page-break-after: avoid; }
  h3 { font-size: 14px; margin: 18px 0 6px; page-break-after: avoid; }
  p { margin: 0 0 10px; color: #3f3f46; }
  em { color: #71717a; }
  strong { color: #18181b; }
  ul { padding-left: 20px; margin: 8px 0 14px; }
  li { margin-bottom: 5px; }
  code { background: #f4f4f1; padding: 1px 4px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; page-break-inside: avoid; }
  th, td { border: 1px solid #e5e7eb; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f4f1; color: #52525b; font-weight: 600; }
  tr:nth-child(even) td { background: #fafaf8; }
  body::after { content: "Anorha report"; display: block; color: #9ca3af; font-size: 10px; margin-top: 30px; padding-top: 10px; border-top: 1px solid #e5e7eb; }
</style></head><body>${markdownToHtml(markdown)}</body></html>`;
}

// Render the current draft as a real PDF, then present the native share/save sheet.
// Falls back to plain text sharing only when PDF generation or file sharing fails.
export async function savePdfFile(title: string, markdown: string): Promise<void> {
  try {
    const rendered = await Print.printToFileAsync({ html: reportPdfHtml(markdown) });
    const uri = `${FileSystem.cacheDirectory}${safeFileName(title)}.pdf`;
    await FileSystem.deleteAsync(uri, { idempotent: true });
    await FileSystem.moveAsync({ from: rendered.uri, to: uri });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: title,
        UTI: 'com.adobe.pdf',
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
  return organizeReportDocument(doc).sections.some((s) => s.kind === 'table' || s.kind === 'metrics');
}

export function documentToCsv(doc: ReportDocument): string {
  const blocks: string[] = [];
  for (const s of organizeReportDocument(doc).sections) {
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
