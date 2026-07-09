import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { AnalyticsEvents, capture } from '../lib/analytics';
import { createLogger } from './logger';

const log = createLogger('pickCsvImport');

export type CsvImportPayload = {
  csvHeaders: string[];
  csvData: Record<string, string>[];
  sampleRow: Record<string, string>;
  connectionName: string;
};

const stripCsvExtension = (name?: string | null) => {
  const clean = String(name || '').trim().replace(/\.[Cc][Ss][Vv]$/, '');
  return clean || 'CSV Import';
};

const parseCsvLine = (line: string): string[] => {
  const values: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(value.trim());
      value = '';
      continue;
    }
    value += char;
  }

  values.push(value.trim());
  return values;
};

export async function pickCsvImportPayload(): Promise<CsvImportPayload | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) {
      return null;
    }

    const file = result.assets[0];
    if (!file.uri) {
      Alert.alert('CSV unavailable', 'Could not open that file.');
      return null;
    }

    const fileContent = await FileSystem.readAsStringAsync(file.uri);
    const lines = fileContent.split(/\r?\n/).filter((line: string) => line.trim());
    if (lines.length < 2) {
      Alert.alert('Invalid CSV', 'Use a file with headers and rows.');
      return null;
    }

    const csvHeaders = parseCsvLine(lines[0]).map((header) => header.replace(/^"|"$/g, '').trim()).filter(Boolean);
    if (csvHeaders.length === 0) {
      Alert.alert('Invalid CSV', 'Use a file with headers.');
      return null;
    }

    const csvData = lines.slice(1).map((line: string) => {
      const values = parseCsvLine(line);
      const row: Record<string, string> = {};
      csvHeaders.forEach((header: string, index: number) => {
        row[header] = values[index] || '';
      });
      return row;
    });

    capture(AnalyticsEvents.INVENTORY_IMPORT_STARTED, { source: 'csv', row_count: csvData.length });

    return {
      csvHeaders,
      csvData,
      sampleRow: csvData[0] || {},
      connectionName: stripCsvExtension(file.name),
    };
  } catch (error: any) {
    log.error('CSV import error:', error);
    Alert.alert('Import failed', error?.message || 'Could not read that CSV.');
    return null;
  }
}
