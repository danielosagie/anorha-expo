// csvImport — the ONE dependency-free CSV entry point for the import pipeline.
//
// Replaces the naive `split('\n')/split(',')` parser that used to live inline in
// ProfileScreen (and was copy-pasted for other CSV entry points). That parser
// mangled any file with quoted commas, embedded newlines, escaped quotes, CRLF
// line endings, or a UTF-8 BOM — i.e. most real exports from Shopify / Square /
// Excel. `parseCsv` below implements RFC-4180 semantics instead.
//
// ── Public API ─────────────────────────────────────────────────────────────
//
//   parseCsv(text)            → { headers: string[]; rows: string[][] }
//                               Pure RFC-4180 tokenizer. Throws past MAX_ROWS.
//   csvRowsToObjects(h, rows) → Array<Record<string, string>>
//                               Zips each row against the header list; ragged
//                               rows are padded ('') / truncated to the headers.
//   pickAndParseCsv()         → Promise<{ headers, data, sampleRow } | null>
//                               Opens the document picker, reads + parses the
//                               file. Resolves null when the user cancels.
//
// ── Caller contract (what the picker helper hands you) ─────────────────────
//
// `pickAndParseCsv()` is the single helper every CSV entry point (ProfileScreen,
// ConnectionsScreen, …) should call. After a successful pick, navigate to the
// column-mapping screen with these EXACT param keys — the screen reads
// `csvHeaders` / `csvData` / `sampleRow` (and an optional `connectionName`):
//
//   const picked = await pickAndParseCsv();
//   if (!picked) return;                       // user cancelled — do nothing
//   navigation.navigate('CSVColumnMapping', {
//     csvHeaders: picked.headers,              // string[]
//     csvData: picked.data,                    // Array<Record<string,string>>
//     sampleRow: picked.sampleRow,             // Record<string,string> (data[0])
//     connectionName,                          // optional label for the import
//   });
//
// The expo-document-picker / expo-file-system modules are imported LAZILY inside
// pickAndParseCsv so this module stays free of native deps at load time — the
// pure functions above are unit-testable under plain Node (see
// __tests__/csvImport.test.ts) with no mocking.

/**
 * Hard cap so a runaway / malicious file can't OOM the JS thread mid-parse.
 * Counts total rows including the header line.
 */
export const MAX_ROWS = 50000;

export type CsvParseResult = {
  headers: string[];
  rows: string[][];
};

export type PickedCsv = {
  headers: string[];
  data: Array<Record<string, string>>;
  sampleRow: Record<string, string>;
};

/**
 * Parse CSV text into a header row + data rows following RFC-4180:
 *  - quoted fields may contain commas, `\n`, and `\r\n`
 *  - a doubled quote (`""`) inside a quoted field is a literal `"`
 *  - trailing empty fields are preserved (`a,b,` → ['a','b',''])
 *  - a leading UTF-8 BOM is stripped
 *  - fully-empty lines are skipped (blank lines between rows)
 *  - `\n`, `\r\n`, and lone `\r` are all accepted as line terminators
 *
 * Throws a descriptive error once the file exceeds {@link MAX_ROWS} rows.
 */
export function parseCsv(text: string): CsvParseResult {
  if (text == null || text === '') return { headers: [], rows: [] };

  // Strip a leading UTF-8 BOM (Excel loves to prepend one).
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);

  const allRows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    pushField();
    // A truly blank line tokenizes to a single empty field — drop it. Rows with
    // legitimate trailing empties (e.g. ['a','']) have length > 1 and survive.
    const isBlankLine = row.length === 1 && row[0] === '';
    if (!isBlankLine) {
      if (allRows.length >= MAX_ROWS) {
        throw new Error(
          `CSV too large: more than ${MAX_ROWS} rows. Split the file and import it in batches.`,
        );
      }
      allRows.push(row);
    }
    row = [];
  };

  const len = src.length;
  for (let i = 0; i < len; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        // `""` → escaped literal quote; a lone `"` closes the quoted section.
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushRow();
    } else if (c === '\r') {
      // Consume the `\n` of a CRLF pair; a lone `\r` is still a terminator.
      if (src[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += c;
    }
  }

  // Flush a final row that wasn't terminated by a trailing newline.
  if (field !== '' || row.length > 0) {
    pushRow();
  }

  if (allRows.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = allRows;
  return { headers, rows };
}

/**
 * Zip parsed rows against the header list into keyed objects. Ragged rows are
 * tolerated: short rows pad missing cells with '', extra cells (beyond the
 * headers) are ignored — matching the shape the mapping screen expects.
 */
export function csvRowsToObjects(
  headers: string[],
  rows: string[][],
): Array<Record<string, string>> {
  return rows.map((cells) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = cells[i] ?? '';
    }
    return obj;
  });
}

/**
 * Open the OS document picker, read the chosen file, and parse it. Resolves
 * `null` when the user cancels the picker. Throws (with a user-readable message)
 * when the file can't be read or has no data rows.
 *
 * See the module header for the exact `navigate('CSVColumnMapping', …)` call the
 * caller should make with the returned `{ headers, data, sampleRow }`.
 */
export async function pickAndParseCsv(): Promise<PickedCsv | null> {
  // Lazy-loaded so this module has no native dependency at import time (keeps
  // the pure parser above testable under plain Node).
  const DocumentPicker = await import('expo-document-picker');
  const FileSystem = await import('expo-file-system/legacy');

  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const file = result.assets[0];
  if (!file.uri) {
    throw new Error('Could not access the selected file.');
  }

  const text = await FileSystem.readAsStringAsync(file.uri);
  const { headers, rows } = parseCsv(text);

  if (headers.length === 0 || rows.length === 0) {
    throw new Error('The file must have a header row and at least one data row.');
  }

  const data = csvRowsToObjects(headers, rows);
  const sampleRow = data[0] ?? {};

  return { headers, data, sampleRow };
}
