/** Postgres isolation levels only. Kysely also has "snapshot" (MSSQL), which is not valid here. */
const BEGIN_SQL = "begin";

const ISOLATION_BEGIN_SQL = {
  "read uncommitted": "start transaction isolation level read uncommitted",
  "read committed": "start transaction isolation level read committed",
  "repeatable read": "start transaction isolation level repeatable read",
  "serializable": "start transaction isolation level serializable",
} as const;

type IsolationKey = keyof typeof ISOLATION_BEGIN_SQL;

function isIsolationKey(value: string): value is IsolationKey {
  return Object.hasOwn(ISOLATION_BEGIN_SQL, value);
}

export class UnsupportedIsolationLevelError extends Error {
  constructor() {
    super("Unsupported transaction isolation level");
    this.name = "UnsupportedIsolationLevelError";
  }
}

/**
 * Build a BEGIN/START TRANSACTION statement from a Kysely isolation level.
 * Empty or missing values use BEGIN. Any other non-allowlisted value throws.
 * The SQL is always a complete literal from the map: the caller string is never concatenated.
 */
export function transactionBeginSql(isolationLevel: string | undefined): string {
  if (isolationLevel == null || isolationLevel.trim() === "") return BEGIN_SQL;
  const normalized = isolationLevel
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!isIsolationKey(normalized)) {
    throw new UnsupportedIsolationLevelError();
  }
  return ISOLATION_BEGIN_SQL[normalized];
}
