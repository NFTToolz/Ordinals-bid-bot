import Table = require('cli-table3');
import chalk = require('chalk');
import * as fs from 'fs';
import * as path from 'path';

export interface TableColumn {
  key: string;
  label: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  formatter?: (value: any, row: Record<string, any>) => string;
}

export interface TableOptions {
  columns: TableColumn[];
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  style?: 'default' | 'compact' | 'borderless';
}

export interface TableData {
  columns: TableColumn[];
  rows: Record<string, any>[];
}

/**
 * Sort rows by a column
 */
export function sortRows(
  rows: Record<string, any>[],
  sortBy: string,
  direction: 'asc' | 'desc' = 'asc'
): Record<string, any>[] {
  return [...rows].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];

    // Handle undefined/null
    if (aVal === undefined || aVal === null) return direction === 'asc' ? 1 : -1;
    if (bVal === undefined || bVal === null) return direction === 'asc' ? -1 : 1;

    // Handle numbers
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    }

    // Handle strings
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    const comparison = aStr.localeCompare(bStr);
    return direction === 'asc' ? comparison : -comparison;
  });
}

/**
 * Create a formatted CLI table
 */
export function createTable(data: TableData, options?: Partial<TableOptions>): string {
  const { columns, rows } = data;
  const sortBy = options?.sortBy;
  const sortDirection = options?.sortDirection || 'asc';
  const style = options?.style || 'default';

  // Sort rows if specified
  let sortedRows = rows;
  if (sortBy) {
    sortedRows = sortRows(rows, sortBy, sortDirection);
  }

  // Configure table style
  const tableConfig: Table.TableConstructorOptions = {
    head: columns.map(col => {
      let label = chalk.bold(col.label);
      // Add sort indicator if this column is sorted
      if (sortBy === col.key) {
        label += sortDirection === 'asc' ? ' ↑' : ' ↓';
      }
      return label;
    }),
    colAligns: columns.map(col => col.align || 'left'),
  };

  // Only set colWidths if at least one column has a width defined
  const hasWidths = columns.some(col => col.width !== undefined);
  if (hasWidths) {
    tableConfig.colWidths = columns.map(col => col.width ?? null) as (number | null)[];
  }

  // Apply style
  if (style === 'compact') {
    tableConfig.style = { 'padding-left': 1, 'padding-right': 1, compact: true };
  } else if (style === 'borderless') {
    tableConfig.chars = {
      'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
      'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
      'left': '', 'left-mid': '', 'mid': '', 'mid-mid': '',
      'right': '', 'right-mid': '', 'middle': ' ',
    };
  }

  const table = new Table(tableConfig);

  // Add rows
  sortedRows.forEach(row => {
    const rowData = columns.map(col => {
      const value = row[col.key];
      if (col.formatter) {
        return col.formatter(value, row);
      }
      if (value === undefined || value === null) {
        return '';
      }
      return String(value);
    });
    table.push(rowData);
  });

  return table.toString();
}

/**
 * Print a table to console
 */
export function printTable(data: TableData, options?: Partial<TableOptions>): void {
  console.log(createTable(data, options));
}

/**
 * Ensure exports directory exists
 */
function ensureExportsDir(): string {
  const exportsDir = path.join(process.cwd(), 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }
  return exportsDir;
}

/**
 * Generate a unique filename with timestamp
 */
function generateFilename(baseName: string, extension: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${baseName}_${timestamp}.${extension}`;
}

/**
 * Export table data to CSV file
 */
export function exportToCSV(
  data: TableData,
  baseName: string = 'export'
): string {
  const exportsDir = ensureExportsDir();
  const filename = generateFilename(baseName, 'csv');
  const filepath = path.join(exportsDir, filename);

  const { columns, rows } = data;

  // Create CSV content
  const header = columns.map(col => `"${col.label.replace(/"/g, '""')}"`).join(',');
  const csvRows = rows.map(row => {
    return columns.map(col => {
      const value = row[col.key];
      if (value === undefined || value === null) {
        return '';
      }
      // Escape quotes and wrap in quotes
      const strValue = String(value).replace(/"/g, '""');
      return `"${strValue}"`;
    }).join(',');
  });

  const csvContent = [header, ...csvRows].join('\n');

  fs.writeFileSync(filepath, csvContent, 'utf-8');
  return filepath;
}

/**
 * Export table data to JSON file
 */
export function exportToJSON(
  data: TableData,
  baseName: string = 'export'
): string {
  const exportsDir = ensureExportsDir();
  const filename = generateFilename(baseName, 'json');
  const filepath = path.join(exportsDir, filename);

  const { columns, rows } = data;

  // Create JSON object with column info and data
  const exportData = {
    exportedAt: new Date().toISOString(),
    columns: columns.map(col => ({
      key: col.key,
      label: col.label,
    })),
    rowCount: rows.length,
    data: rows.map(row => {
      const cleanRow: Record<string, any> = {};
      columns.forEach(col => {
        cleanRow[col.key] = row[col.key];
      });
      return cleanRow;
    }),
  };

  fs.writeFileSync(filepath, JSON.stringify(exportData, null, 2), 'utf-8');
  return filepath;
}

/**
 * Get table statistics
 */
export function getTableStats(data: TableData): {
  rowCount: number;
  columnCount: number;
} {
  return {
    rowCount: data.rows.length,
    columnCount: data.columns.length,
  };
}
