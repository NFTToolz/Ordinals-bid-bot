import inquirer = require('inquirer');
import chalk = require('chalk');
import {
  TableColumn,
  TableData,
  createTable,
  sortRows,
  exportToCSV,
  exportToJSON,
} from './table';
import { showSuccess, showInfo, clearScreen, getSeparatorWidth } from './display';

export interface InteractiveTableOptions {
  title?: string;
  pageSize?: number;
  allowSort?: boolean;
  allowExport?: boolean;
  exportBaseName?: string;
}

interface TableState {
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  currentPage: number;
  pageSize: number;
}

/**
 * Display an interactive table with sorting, pagination, and export options
 */
export async function showInteractiveTable(
  data: TableData,
  options: InteractiveTableOptions = {}
): Promise<void> {
  const {
    title,
    pageSize = 15,
    allowSort = true,
    allowExport = true,
    exportBaseName = 'export',
  } = options;

  const { columns, rows } = data;

  if (rows.length === 0) {
    showInfo('No data to display');
    return;
  }

  const state: TableState = {
    sortBy: null,
    sortDirection: 'asc',
    currentPage: 1,
    pageSize,
  };

  const totalPages = Math.ceil(rows.length / pageSize);

  while (true) {
    clearScreen();

    // Show title if provided
    if (title) {
      console.log('');
      console.log(chalk.bold(`  ${title}`));
      console.log(chalk.dim('━'.repeat(getSeparatorWidth())));
    }

    // Get sorted rows
    let displayRows = rows;
    if (state.sortBy) {
      displayRows = sortRows(rows, state.sortBy, state.sortDirection);
    }

    // Calculate pagination
    const startIndex = (state.currentPage - 1) * state.pageSize;
    const endIndex = Math.min(startIndex + state.pageSize, displayRows.length);
    const pageRows = displayRows.slice(startIndex, endIndex);

    // Create table data for current page
    const pageData: TableData = {
      columns,
      rows: pageRows,
    };

    // Display table
    console.log('');
    console.log(createTable(pageData, {
      sortBy: state.sortBy || undefined,
      sortDirection: state.sortDirection,
    }));

    // Show pagination info
    const currentTotalPages = Math.ceil(rows.length / state.pageSize);
    console.log('');
    console.log(chalk.dim(`  Showing ${startIndex + 1}-${endIndex} of ${rows.length} rows  |  Page ${state.currentPage}/${currentTotalPages}`));

    if (state.sortBy) {
      const sortCol = columns.find(c => c.key === state.sortBy);
      const sortLabel = sortCol?.label || state.sortBy;
      console.log(chalk.dim(`  Sorted by: ${sortLabel} (${state.sortDirection === 'asc' ? 'ascending' : 'descending'})`));
    }
    console.log('');

    // Build menu choices
    const choices: Array<{ name: string; value: string }> = [];

    // Pagination controls
    if (state.currentPage > 1) {
      choices.push({ name: '← Previous page', value: 'prev' });
    }
    if (state.currentPage < currentTotalPages) {
      choices.push({ name: '→ Next page', value: 'next' });
    }

    // Sorting
    if (allowSort && columns.length > 0) {
      choices.push({ name: 'Sort by column...', value: 'sort' });
    }

    // Export
    if (allowExport) {
      choices.push({ name: 'Export to CSV', value: 'export-csv' });
      choices.push({ name: 'Export to JSON', value: 'export-json' });
    }

    // Back
    choices.push({ name: '← Back', value: 'back' });

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'Options:',
      choices,
      pageSize: 10,
    }]);

    switch (action) {
      case 'prev':
        state.currentPage = Math.max(1, state.currentPage - 1);
        break;

      case 'next':
        state.currentPage = Math.min(currentTotalPages, state.currentPage + 1);
        break;

      case 'sort': {
        const sortResult = await showSortMenu(columns, state.sortBy, state.sortDirection);
        if (sortResult) {
          state.sortBy = sortResult.sortBy;
          state.sortDirection = sortResult.sortDirection;
          state.currentPage = 1; // Reset to first page when sorting changes
        }
        break;
      }

      case 'export-csv': {
        const filepath = exportToCSV({ columns, rows: displayRows }, exportBaseName);
        showSuccess(`Exported to: ${filepath}`);
        await promptAnyKey();
        break;
      }

      case 'export-json': {
        const filepath = exportToJSON({ columns, rows: displayRows }, exportBaseName);
        showSuccess(`Exported to: ${filepath}`);
        await promptAnyKey();
        break;
      }

      case 'back':
        return;
    }
  }
}

/**
 * Show sort column selection menu
 */
async function showSortMenu(
  columns: TableColumn[],
  currentSortBy: string | null,
  currentDirection: 'asc' | 'desc'
): Promise<{ sortBy: string; sortDirection: 'asc' | 'desc' } | null> {
  const choices = columns.map(col => {
    let name = col.label;
    if (col.key === currentSortBy) {
      name += currentDirection === 'asc' ? ' ↑' : ' ↓';
    }
    return { name, value: col.key };
  });

  choices.push({ name: '← Cancel', value: '_cancel' });

  const { column } = await inquirer.prompt([{
    type: 'list',
    name: 'column',
    message: 'Sort by which column?',
    choices,
    pageSize: 15,
  }]);

  if (column === '_cancel') {
    return null;
  }

  // If same column, toggle direction
  let newDirection: 'asc' | 'desc' = 'asc';
  if (column === currentSortBy) {
    newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
  }

  return {
    sortBy: column,
    sortDirection: newDirection,
  };
}

/**
 * Wait for user to press any key
 */
async function promptAnyKey(): Promise<void> {
  await inquirer.prompt([{
    type: 'input',
    name: 'continue',
    message: 'Press Enter to continue...',
  }]);
}

/**
 * Simple paginated display without full interactive features
 * Good for quick display of data
 */
export function displayPaginatedTable(
  data: TableData,
  page: number = 1,
  pageSize: number = 15
): { hasNext: boolean; hasPrev: boolean; totalPages: number } {
  const { columns, rows } = data;
  const totalPages = Math.ceil(rows.length / pageSize);
  const startIndex = (page - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, rows.length);
  const pageRows = rows.slice(startIndex, endIndex);

  const pageData: TableData = {
    columns,
    rows: pageRows,
  };

  console.log(createTable(pageData));
  console.log('');
  console.log(chalk.dim(`  Page ${page}/${totalPages}  |  ${rows.length} total rows`));

  return {
    hasNext: page < totalPages,
    hasPrev: page > 1,
    totalPages,
  };
}
