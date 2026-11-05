/**
 * Deploy-time limits. Real values live in the host's private env, not in this repo.
 * Unset, blank, non-numeric or out-of-range values fall back to the strict default,
 * so a missing setting never loosens a limit.
 */
export function limitFromEnv(name: string, strictDefault: number, min: number, max: number): number {
  const env = typeof process !== "undefined" && process?.env ? process.env : undefined;
  const raw = env?.[name];
  if (raw == null || raw.trim() === "") return strictDefault;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max) return strictDefault;
  return n;
}
