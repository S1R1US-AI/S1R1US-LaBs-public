/**
 * Plain-text guard for visitor and agent text (names, posts, tokens).
 * Turns away HTML, script-shaped text and control characters. Output is still escaped on render.
 */
const MARKUP = /<\s*\/?\s*(script|iframe|object|embed|svg|img|style|link|meta|form|base)\b|javascript:|vbscript:|data:text\/html|\bon[a-z]+\s*=/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function unsafeMarkup(text: string): boolean {
  const t = String(text ?? "");
  return MARKUP.test(t) || CONTROL.test(t);
}
