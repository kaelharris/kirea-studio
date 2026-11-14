import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export class StudioDatabase {
  public db: Database.Database;
  public readonly dbPath: string;
  public recoveredFromCorruption = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = this.openAndVerify(dbPath);
    this.runMigrations();
  }

  private openAndVerify(dbPath: string): Database.Database {
    const attemptOpen = (target: string) => {
      let conn: Database.Database | null = null;
      try {
        conn = new Database(target);
        conn.pragma("journal_mode = WAL");
        conn.pragma("synchronous = NORMAL");
        conn.pragma("foreign_keys = ON");
        conn.pragma("busy_timeout = 5000");
        const check = conn.pragma("quick_check", { simple: true });
        if (check !== "ok") {
          throw new Error(`SQLite integrity check failed: ${String(check)}`);
        }
        return conn;
      } catch (inner) {
        if (conn) {
          try {
            conn.close();
          } catch {
            // ignore close failure on corrupt handle
          }
        }
        throw inner;
      }
    };

    try {
      return attemptOpen(dbPath);
    } catch (err) {
      if (dbPath === ":memory:") {
        throw err;
      }
      // Preserve corrupt file for forensic inspection and recreate clean DB
      const backupPath = `${dbPath}.corrupt.${Date.now()}.bak`;
      try {
        if (fs.existsSync(dbPath)) {
          fs.renameSync(dbPath, backupPath);
        }
        for (const suffix of ["-wal", "-shm"]) {
          if (fs.existsSync(dbPath + suffix)) {
            fs.renameSync(dbPath + suffix, backupPath + suffix);
          }
        }
      } catch {
        // Best-effort backup
      }
      this.recoveredFromCorruption = true;
      return attemptOpen(dbPath);
    }
  }

  private runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const appliedRows = this.db
      .prepare("SELECT version FROM schema_migrations")
      .all() as Array<{ version: number }>;
    const applied = new Set(appliedRows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      const runTx = this.db.transaction(() => {
        migration.up(this.db);
        this.db
          .prepare(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
          )
          .run(migration.version, migration.name, new Date().toISOString());
      });
      runTx();
    }
  }

  getSchemaVersion(): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations")
      .get() as { v: number };
    return row.v;
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    if (this.db.open) {
      this.db.close();
    }
  }
}
