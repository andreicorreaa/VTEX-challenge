import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  importProducts,
  type ImportItemResult,
} from "./importer.js";
import { parseProductsJson } from "./reader.js";
import { createCatalogRepository } from "./repository.js";

type CliOptions = {
  inputPath: string;
  databasePath: string;
  reportPath?: string;
  dryRun: boolean;
};

function usage(): string {
  return [
    "Usage: npm run import -- --input <database.json> --db <catalog.db> [--dry-run] [--report <path>]",
    "",
    "Options:",
    "  --input <path>   Input JSON path",
    "  --db <path>      SQLite database path (required)",
    "  --dry-run        Execute and rollback all writes",
    "  --report <path>  Write a detailed HTML report",
  ].join("\n");
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderReportHtml(report: {
  startedAt: string;
  finishedAt: string;
  input: string;
  database: string;
  dryRun: boolean;
  summary: {
    read: number;
    productsMatched: number;
    productsCreated: number;
    dedupedWithinFile: number;
    offersCreated: number;
    offersSkipped: number;
    categoryConflicts: number;
  };
  items: ImportItemResult[];
}): string {
  const summaryEntries = Object.entries(report.summary)
    .map(
      ([label, value]) =>
        `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");
  const itemRows = report.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.sellerName)}</td>
        <td>${escapeHtml(item.sellerProductId)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.productAction)}</td>
        <td>${escapeHtml(item.productId)}</td>
        <td>${escapeHtml(item.offerAction)}</td>
        <td>${item.categoryConflict ? "Yes" : "No"}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Catalog import report</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 2rem; color: #17202a; background: #f4f6f8; }
    main { max-width: 1400px; margin: auto; }
    h1 { margin-top: 0; }
    .meta, .metrics { display: grid; gap: 1rem; }
    .meta { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-bottom: 1rem; }
    .metrics { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin: 1rem 0 2rem; }
    .panel, .metric { padding: 1rem; background: white; border: 1px solid #d9dee3; border-radius: 8px; }
    .metric span { display: block; color: #5f6b76; font-size: .85rem; }
    .metric strong { display: block; margin-top: .35rem; font-size: 1.5rem; }
    .table-wrap { overflow-x: auto; background: white; border: 1px solid #d9dee3; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; white-space: nowrap; }
    th, td { padding: .65rem .8rem; text-align: left; border-bottom: 1px solid #e8ebee; }
    th { background: #eef1f4; position: sticky; top: 0; }
    tr:last-child td { border-bottom: 0; }
    code { overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>Catalog import report</h1>
    <section class="panel meta">
      <div><strong>Input</strong><br><code>${escapeHtml(report.input)}</code></div>
      <div><strong>Database</strong><br><code>${escapeHtml(report.database)}</code></div>
      <div><strong>Started</strong><br>${escapeHtml(report.startedAt)}</div>
      <div><strong>Finished</strong><br>${escapeHtml(report.finishedAt)}</div>
      <div><strong>Mode</strong><br>${report.dryRun ? "Dry run (rolled back)" : "Import"}</div>
    </section>
    <section class="metrics">${summaryEntries}</section>
    <h2>Items (${escapeHtml(report.items.length)})</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Seller</th><th>Seller product ID</th><th>Name</th><th>Product action</th><th>Product ID</th><th>Offer action</th><th>Category conflict</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}

function parseArguments(args: string[]): CliOptions {
  const inputIndex = args.indexOf("--input");
  const databaseIndex = args.indexOf("--db");
  const reportIndex = args.indexOf("--report");
  const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
  const databasePath = databaseIndex >= 0 ? args[databaseIndex + 1] : undefined;
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;

  if (!inputPath || !databasePath || (reportIndex >= 0 && !reportPath)) {
    throw new Error(usage());
  }

  return {
    inputPath,
    databasePath,
    ...(reportPath ? { reportPath } : {}),
    dryRun: args.includes("--dry-run"),
  };
}

async function run(args: string[]): Promise<void> {
  const options = parseArguments(args);
  const inputJson = await readFile(options.inputPath, "utf8");
  const products = parseProductsJson(inputJson);
  const repository = createCatalogRepository(options.databasePath);

  try {
    const startedAt = new Date().toISOString();
    const result = importProducts(repository, products, {
      dryRun: options.dryRun,
    });
    const finishedAt = new Date().toISOString();
    const output = { ...result, dryRun: options.dryRun };
    const consoleSummary = {
      read: result.read,
      productsMatched: result.productsMatched,
      productsCreated: result.productsCreated,
      dedupedWithinFile: result.dedupedWithinFile,
      offersCreated: result.offersCreated,
      offersSkipped: result.offersSkipped,
      categoryConflicts: result.categoryConflicts,
      dryRun: options.dryRun,
    };

    if (options.reportPath) {
      await mkdir(dirname(options.reportPath), { recursive: true });
      await writeFile(
        options.reportPath,
        renderReportHtml({
          startedAt,
          finishedAt,
          input: options.inputPath,
          database: options.databasePath,
          dryRun: options.dryRun,
          summary: {
            read: result.read,
            productsMatched: result.productsMatched,
            productsCreated: result.productsCreated,
            dedupedWithinFile: result.dedupedWithinFile,
            offersCreated: result.offersCreated,
            offersSkipped: result.offersSkipped,
            categoryConflicts: result.categoryConflicts,
          },
          items: result.items,
        }),
        "utf8",
      );
    }

    console.log(JSON.stringify(consoleSummary, null, 2));
  } finally {
    repository.close();
  }
}

run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
