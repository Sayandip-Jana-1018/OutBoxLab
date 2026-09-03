import { parse } from 'csv-parse/sync';
import { badRequest } from '../../lib/errors';
import type { TemplateVars } from '../../services/template';

export interface ParsedRecipient {
  email: string;
  vars: TemplateVars;
}

export interface RecipientParseResult {
  recipients: ParsedRecipient[];
  /** Rows whose address failed validation, with the reason. */
  invalid: { value: string; reason: string }[];
  /** Addresses that appeared more than once (only the first is kept). */
  duplicates: string[];
  /** Variable names available to the templates. */
  variables: string[];
}

/** Header names accepted for the address column, in priority order. */
const ADDRESS_COLUMNS = ['email', 'to', 'address', 'recipient', 'e-mail'];

// Intentionally pragmatic rather than RFC 5322 complete: catches the mistakes
// people actually make in spreadsheets without rejecting valid addresses.
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

function normaliseHeader(header: string): string {
  return header.trim().toLowerCase();
}

/**
 * Turn raw CSV text into recipients.
 *
 * Every non-address column becomes a template variable for that row, so a CSV
 * of `email,name,company` immediately supports `{{name}}` and `{{company}}` in
 * the subject and body with no extra configuration.
 */
export function parseCsvRecipients(csv: string): RecipientParseResult {
  let rows: Record<string, string>[];

  try {
    rows = parse(csv, {
      columns: (header: string[]) => header.map(normaliseHeader),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];
  } catch (error) {
    throw badRequest(`Could not parse CSV: ${(error as Error).message}`);
  }

  if (rows.length === 0) {
    throw badRequest('The CSV contains no data rows');
  }

  const headers = Object.keys(rows[0] ?? {});
  const addressColumn = ADDRESS_COLUMNS.find((candidate) => headers.includes(candidate));

  if (!addressColumn) {
    throw badRequest(
      `The CSV needs an address column named one of: ${ADDRESS_COLUMNS.join(', ')}. Found: ${headers.join(', ') || '(none)'}`,
    );
  }

  const variableColumns = headers.filter((header) => header !== addressColumn);

  return dedupe(
    rows.map((row) => {
      const vars: TemplateVars = {};
      for (const column of variableColumns) {
        vars[column] = row[column] ?? '';
      }
      return { email: (row[addressColumn] ?? '').trim().toLowerCase(), vars };
    }),
    variableColumns,
  );
}

/** Validate + de-duplicate an already-structured recipient list. */
export function normaliseRecipients(
  input: { email: string; vars?: TemplateVars }[],
): RecipientParseResult {
  const variables = new Set<string>();
  for (const item of input) {
    for (const name of Object.keys(item.vars ?? {})) {
      variables.add(name);
    }
  }

  return dedupe(
    input.map((item) => ({
      email: item.email.trim().toLowerCase(),
      vars: item.vars ?? {},
    })),
    [...variables],
  );
}

function dedupe(
  candidates: ParsedRecipient[],
  variables: string[],
): RecipientParseResult {
  const seen = new Set<string>();
  const recipients: ParsedRecipient[] = [];
  const invalid: { value: string; reason: string }[] = [];
  const duplicates: string[] = [];

  for (const candidate of candidates) {
    if (!candidate.email) {
      invalid.push({ value: '(blank)', reason: 'Missing email address' });
      continue;
    }
    if (!EMAIL_PATTERN.test(candidate.email)) {
      invalid.push({ value: candidate.email, reason: 'Not a valid email address' });
      continue;
    }
    // De-duplicating up front matters: the unique index on
    // (campaignId, to) would otherwise abort the whole insert.
    if (seen.has(candidate.email)) {
      duplicates.push(candidate.email);
      continue;
    }

    seen.add(candidate.email);
    recipients.push(candidate);
  }

  if (recipients.length === 0) {
    throw badRequest('No valid recipients found', { invalid: invalid.slice(0, 20) });
  }

  return { recipients, invalid, duplicates, variables };
}
