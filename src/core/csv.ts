/** RFC 4180 CSV writer: comma separated, CRLF line endings, quotes doubled. */

export type CsvCell = string | number | null | undefined;

/** Characters that make spreadsheet apps treat a cell as a formula. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Escape a single cell. Strings containing a comma, quote, CR or LF are quoted, with
 * embedded quotes doubled. Text cells that begin like a formula are prefixed with an
 * apostrophe so opening the file in Excel or Sheets can't execute them (CSV injection).
 * Numbers are written as-is, so negative numbers stay numeric.
 */
export function escapeCsvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return Number.isFinite(cell) ? String(cell) : "";
  let text = cell;
  if (FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
