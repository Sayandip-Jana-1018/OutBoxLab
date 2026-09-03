/**
 * Minimal, deliberately non-executing template renderer for `{{variable}}`
 * placeholders.
 *
 * A real templating engine (Handlebars, EJS, ...) would be overkill and would
 * put an expression evaluator in the path of user-supplied campaign copy. This
 * substitutes plain keys only - no logic, no property traversal, no code
 * execution - which keeps the blast radius of a malicious template at zero.
 */

export type TemplateVars = Record<string, unknown>;

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Extract the distinct variable names referenced by a template. */
export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Replace every placeholder with its value.
 * Unknown placeholders fall back to `fallback` (default: empty string) so a
 * missing CSV column can never leak a raw `{{name}}` into a real inbox.
 */
export function render(
  template: string,
  vars: TemplateVars,
  fallback = '',
): string {
  return template.replace(PLACEHOLDER, (_full, rawName: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, rawName)) {
      return stringify(vars[rawName]);
    }
    return fallback;
  });
}

/** Escape a rendered plain-text body for safe inclusion in an HTML email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap a plain-text body in a clean, client-safe HTML shell. */
export function toHtmlEmail(subject: string, body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px;">${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;color:#18181b;line-height:1.6;font-size:15px;">
      <h1 style="margin:0 0 20px;font-size:19px;font-weight:600;">${escapeHtml(subject)}</h1>
      ${paragraphs}
    </div>
    <p style="max-width:560px;margin:16px auto 0;font-size:11px;color:#8b8b95;text-align:center;">
      Delivered by OutboxLab
    </p>
  </body>
</html>`;
}
