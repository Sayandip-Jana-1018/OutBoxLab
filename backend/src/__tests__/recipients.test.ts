import { describe, expect, it } from 'vitest';
import { normaliseRecipients, parseCsvRecipients } from '../modules/campaigns/recipients';

describe('CSV recipient parsing', () => {
  it('maps non-address columns to template variables', () => {
    const result = parseCsvRecipients(
      'email,name,company\nada@example.com,Ada,AE\ngrace@example.com,Grace,Compiler Co',
    );

    expect(result.recipients).toHaveLength(2);
    expect(result.recipients[0]).toEqual({
      email: 'ada@example.com',
      vars: { name: 'Ada', company: 'AE' },
    });
    expect(result.variables.sort()).toEqual(['company', 'name']);
  });

  it('accepts any of the supported address column names', () => {
    for (const column of ['email', 'to', 'address', 'recipient']) {
      const result = parseCsvRecipients(`${column},name\nada@example.com,Ada`);
      expect(result.recipients[0]?.email).toBe('ada@example.com');
    }
  });

  it('is case-insensitive about headers and lowercases addresses', () => {
    const result = parseCsvRecipients('EMAIL,Name\nADA@EXAMPLE.COM,Ada');
    expect(result.recipients[0]?.email).toBe('ada@example.com');
    expect(result.recipients[0]?.vars).toEqual({ name: 'Ada' });
  });

  it('separates invalid addresses instead of failing the whole upload', () => {
    const result = parseCsvRecipients(
      'email\nada@example.com\nnot-an-email\n\nmissing-at-sign.com\ngrace@example.com',
    );

    expect(result.recipients.map((r) => r.email)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ]);
    expect(result.invalid.length).toBeGreaterThanOrEqual(2);
  });

  it('de-duplicates, keeping the first occurrence', () => {
    // The unique index on (campaignId, to) would abort the whole insert, so
    // duplicates must be removed before they reach the database.
    const result = parseCsvRecipients(
      'email,name\nada@example.com,First\nADA@example.com,Second\ngrace@example.com,Grace',
    );

    expect(result.recipients).toHaveLength(2);
    expect(result.recipients[0]?.vars).toEqual({ name: 'First' });
    expect(result.duplicates).toEqual(['ada@example.com']);
  });

  it('handles a UTF-8 BOM', () => {
    const result = parseCsvRecipients('﻿email,name\nada@example.com,Ada');
    expect(result.recipients[0]?.email).toBe('ada@example.com');
  });

  it('rejects a CSV with no recognisable address column', () => {
    expect(() => parseCsvRecipients('firstname,lastname\nAda,Lovelace')).toThrow(
      /address column/i,
    );
  });

  it('rejects a CSV with no data rows', () => {
    expect(() => parseCsvRecipients('email,name')).toThrow(/no data rows/i);
  });

  it('rejects input where every row is invalid', () => {
    expect(() => parseCsvRecipients('email\nnope\nalso-nope')).toThrow(/no valid recipients/i);
  });
});

describe('structured recipient normalisation', () => {
  it('validates and de-duplicates a recipients array', () => {
    const result = normaliseRecipients([
      { email: 'Ada@Example.com', vars: { name: 'Ada' } },
      { email: 'ada@example.com', vars: { name: 'Duplicate' } },
      { email: 'broken', vars: {} },
      { email: 'grace@example.com' },
    ]);

    expect(result.recipients).toHaveLength(2);
    expect(result.duplicates).toEqual(['ada@example.com']);
    expect(result.invalid).toHaveLength(1);
    expect(result.recipients[1]?.vars).toEqual({});
  });
});
