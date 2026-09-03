import { describe, expect, it } from 'vitest';
import { escapeHtml, extractVariables, render, toHtmlEmail } from '../services/template';

describe('template renderer', () => {
  it('substitutes known variables', () => {
    expect(render('Hi {{name}}, welcome to {{company}}', { name: 'Ada', company: 'AE' })).toBe(
      'Hi Ada, welcome to AE',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(render('Hi {{  name  }}', { name: 'Grace' })).toBe('Hi Grace');
  });

  it('replaces unknown variables with the fallback instead of leaking the placeholder', () => {
    // A raw {{name}} arriving in a real inbox is the failure mode this prevents.
    expect(render('Hi {{missing}}!', {})).toBe('Hi !');
    expect(render('Hi {{missing}}!', {}, 'there')).toBe('Hi there!');
  });

  it('coerces numbers and booleans, and blanks out null/undefined', () => {
    expect(render('{{count}} / {{flag}}', { count: 42, flag: true })).toBe('42 / true');
    expect(render('[{{a}}][{{b}}]', { a: null, b: undefined })).toBe('[][]');
  });

  it('does not evaluate expressions or traverse prototypes', () => {
    // Only literal own-keys are substituted - no logic, no code execution.
    expect(render('{{constructor}}', {})).toBe('');
    expect(render('{{__proto__}}', {})).toBe('');
    expect(render('{{toString}}', {})).toBe('');
  });

  it('leaves malformed placeholders untouched', () => {
    expect(render('{{ not closed', { name: 'x' })).toBe('{{ not closed');
    expect(render('{ single }', {})).toBe('{ single }');
  });

  it('extracts the distinct variables a template uses', () => {
    expect(extractVariables('{{a}} {{b}} {{a}}').sort()).toEqual(['a', 'b']);
    expect(extractVariables('no variables here')).toEqual([]);
  });
});

describe('html email shell', () => {
  it('escapes HTML so campaign copy cannot inject markup', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml(`a & b "c" 'd'`)).toBe('a &amp; b &quot;c&quot; &#39;d&#39;');
  });

  it('escapes the subject and body inside the rendered email', () => {
    const html = toHtmlEmail('<b>subject</b>', '<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('&lt;b&gt;subject&lt;/b&gt;');
  });

  it('turns blank lines into paragraphs and single newlines into breaks', () => {
    const html = toHtmlEmail('Subject', 'para one\n\npara two\nsame para');

    // Count only body paragraphs by their distinctive style; the shell also
    // emits a "Delivered by OutboxLab" footer paragraph of its own.
    expect(html.match(/<p style="margin:0 0 16px;">/g)?.length).toBe(2);
    expect(html).toContain('<br />');
    expect(html).toContain('Delivered by OutboxLab');
  });
});
