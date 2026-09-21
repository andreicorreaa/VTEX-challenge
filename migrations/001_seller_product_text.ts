import Database from "better-sqlite3";

function getDatabasePath(args: string[]): string {
  const index = args.indexOf("--db");
  const databasePath = index >= 0 ? args[index + 1] : undefined;

  if (!databasePath) {
    throw new Error("Usage: npm run migrate -- --db <database-path>");
  }

  return databasePath;
}

function migrate(databasePath: string): void {
  const database = new Database(databasePath);

  try {
    database.pragma("foreign_keys = ON");

    const table = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'SellerProduct'",
      )
      .get() as { name: string } | undefined;

    if (!table) {
      throw new Error("Table SellerProduct was not found");
    }

    const { count } = database
      .prepare("SELECT COUNT(*) AS count FROM SellerProduct")
      .get() as { count: number };

    if (count > 0) {
      throw new Error(
        `Migration aborted: SellerProduct contains ${count} row(s)`,
      );
    }

    const transaction = database.transaction(() => {
      database.exec("DROP TABLE SellerProduct");
      database.exec(`
        CREATE TABLE SellerProduct (
          Id INTEGER PRIMARY KEY AUTOINCREMENT,
          SellerName TEXT NOT NULL,
          ProductId INTEGER NOT NULL REFERENCES Product (Id),
          SellerProductId TEXT NOT NULL,
          UNIQUE (SellerName, SellerProductId)
        )
      `);
    });

    transaction();
    console.log(`Migration completed: ${databasePath}`);
  } finally {
    database.close();
  }
}

try {
  migrate(getDatabasePath(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
