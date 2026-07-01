// documentExport — serialize an agent-authored report to Markdown, and copy/share it.
// Markdown is the portable format; Share hands it to the OS sheet (Notes, Mail, etc.).
import * as Clipboard from 'expo-clipboard';
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

export async function copyDocument(doc: ReportDocument): Promise<void> {
  await Clipboard.setStringAsync(documentToMarkdown(doc));
}

export async function shareDocument(doc: ReportDocument): Promise<void> {
  await Share.share({ title: doc.title, message: documentToMarkdown(doc) });
}
