import type { ToolDefinition } from '../types.js';
import { extractEmails } from './extract/extract-emails.js';
import { extractUrls } from './extract/extract-urls.js';
import { extractDomains } from './extract/extract-domains.js';
import { extractIp } from './extract/extract-ip.js';
import { cleanLines } from './clean/clean-lines.js';
import { removeDuplicates } from './clean/remove-duplicates.js';
import { filterLines } from './clean/filter-lines.js';
import { splitColumns } from './columns/split-columns.js';
import { selectColumns } from './columns/select-columns.js';
import { listToCsv } from './convert/list-to-csv.js';
import { csvToJson } from './convert/csv-to-json.js';
import { base64 } from './encode/base64.js';
import { urlEncode } from './encode/url-encode.js';
import { jsonFormat } from './format/json-format.js';
// @new-tool:import (pnpm new-tool inserts above this line)

/**
 * Every tool, one file each under `tools/<category>/<id>.ts`. The catalog is
 * sorted by category (see TOOL_CATEGORIES), so append new tools at the end.
 */
export const TOOLS = [
  extractEmails,
  extractUrls,
  extractDomains,
  extractIp,
  cleanLines,
  removeDuplicates,
  filterLines,
  splitColumns,
  selectColumns,
  listToCsv,
  csvToJson,
  base64,
  urlEncode,
  jsonFormat,
  // @new-tool:entry (pnpm new-tool inserts above this line)
] as ToolDefinition<any>[];
