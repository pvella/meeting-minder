import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { Capacitor } from "@capacitor/core";
import { drizzle } from "drizzle-orm/sqlite-proxy";

const DB_NAME = "meetingminder";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const isWeb = () => Capacitor.getPlatform() === "web";

const sqlite = new SQLiteConnection(CapacitorSQLite);
let connectionPromise: Promise<SQLiteDBConnection> | null = null;

/**
 * On the web (dev only) jeep-sqlite runs sql.js against an in-memory database
 * backed by IndexedDB. It needs its custom element mounted and the web store
 * initialised before any connection is opened.
 */
async function initialiseWebStore() {
  const { defineCustomElements } = await import("jeep-sqlite/loader");
  defineCustomElements(window);
  if (!document.querySelector("jeep-sqlite")) {
    document.body.appendChild(document.createElement("jeep-sqlite"));
  }
  await customElements.whenDefined("jeep-sqlite");
  await sqlite.initWebStore();
}

async function openConnection(): Promise<SQLiteDBConnection> {
  if (isWeb()) await initialiseWebStore();

  // A stale connection survives hot reloads in dev; reuse it rather than
  // failing with "connection already exists".
  const existing = await sqlite.isConnection(DB_NAME, false);
  const connection = existing.result
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);

  const isOpen = await connection.isDBOpen();
  if (!isOpen.result) await connection.open();

  // SQLite defaults foreign keys OFF, which would silently disable every
  // ON DELETE CASCADE in the schema.
  await connection.execute("PRAGMA foreign_keys = ON;", false);

  await runMigrations(connection);
  return connection;
}

export function getConnection(): Promise<SQLiteDBConnection> {
  if (!connectionPromise) {
    connectionPromise = openConnection().catch(error => {
      // Don't cache a failed connection — let the next call retry.
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

/**
 * Applies any migration in ./drizzle not yet recorded in the tracking table.
 * Files are named 0000_*, 0001_* … by drizzle-kit, so lexicographic order is
 * generation order.
 */
async function runMigrations(connection: SQLiteDBConnection) {
  const modules = import.meta.glob("../../drizzle/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  await connection.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       tag TEXT PRIMARY KEY,
       appliedAtMs INTEGER NOT NULL
     );`,
    false,
  );

  const applied = await connection.query(`SELECT tag FROM ${MIGRATIONS_TABLE};`);
  const alreadyApplied = new Set(
    (applied.values ?? []).map(row => (row as { tag: string }).tag),
  );

  const pending = Object.entries(modules)
    .map(([path, sql]) => ({ tag: path.split("/").pop()!.replace(/\.sql$/, ""), sql }))
    .filter(migration => !alreadyApplied.has(migration.tag))
    .sort((left, right) => left.tag.localeCompare(right.tag));

  for (const migration of pending) {
    const statements = migration.sql
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);

    await connection.execute("BEGIN TRANSACTION;", false);
    try {
      for (const statement of statements) {
        await connection.execute(statement, false);
      }
      await connection.run(
        `INSERT INTO ${MIGRATIONS_TABLE} (tag, appliedAtMs) VALUES (?, ?);`,
        [migration.tag, Date.now()],
        false,
      );
      await connection.execute("COMMIT;", false);
    } catch (error) {
      await connection.execute("ROLLBACK;", false);
      throw new Error(
        `Migration ${migration.tag} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    console.info(`[sqlite] applied migration ${migration.tag}`);
  }

  if (pending.length > 0) await persistWebStore();
}

/** On web the database is in memory until explicitly flushed to IndexedDB. */
async function persistWebStore() {
  if (!isWeb()) return;
  try {
    await sqlite.saveToStore(DB_NAME);
  } catch (error) {
    console.warn("[sqlite] could not persist web store", error);
  }
}

/**
 * Drizzle's sqlite-proxy driver. It expects rows as positional value arrays,
 * but Capacitor SQLite returns column-keyed objects — hence the Object.values
 * mapping. That relies on the driver emitting keys in SELECT order, which it
 * does; it would break only on a query selecting two identically-named columns
 * (a join without aliases), which nothing here does.
 */
export const db = drizzle(async (sql, params, method) => {
  const connection = await getConnection();

  if (method === "run") {
    await connection.run(sql, params, false);
    await persistWebStore();
    return { rows: [] };
  }

  const result = await connection.query(sql, params);
  const rows = (result.values ?? []).map(row =>
    Array.isArray(row) ? row : Object.values(row as Record<string, unknown>),
  );

  return { rows: method === "get" ? (rows[0] ?? []) : rows };
});

let inTransaction = false;

/**
 * Explicit transaction boundary. The sqlite-proxy driver has no transaction
 * support of its own, so this drives BEGIN/COMMIT on the shared connection.
 * SQLite cannot nest transactions, so a re-entrant call just joins the
 * enclosing one.
 */
export async function withTransaction<T>(run: () => Promise<T>): Promise<T> {
  if (inTransaction) return run();

  const connection = await getConnection();
  inTransaction = true;
  await connection.execute("BEGIN TRANSACTION;", false);
  try {
    const result = await run();
    await connection.execute("COMMIT;", false);
    await persistWebStore();
    return result;
  } catch (error) {
    await connection.execute("ROLLBACK;", false);
    throw error;
  } finally {
    inTransaction = false;
  }
}
