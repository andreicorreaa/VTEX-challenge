import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SourceIdConflictError, importProducts } from "../src/importer.js";
import type { ProductInput } from "../src/reader.js";
import {
  type CatalogRepository,
  createCatalogRepository,
} from "../src/repository.js";

function createDatabasePath(): string {
  return join(tmpdir(), `catalog-importer-${randomUUID()}.db`);
}

function createSchema(databasePath: string): void {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE Product (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      Name TEXT NOT NULL,
      Brand TEXT,
      Category TEXT
    );

    CREATE TABLE SellerProduct (
      Id INTEGER PRIMARY KEY AUTOINCREMENT,
      SellerName TEXT NOT NULL,
      ProductId INTEGER NOT NULL REFERENCES Product (Id),
      SellerProductId TEXT NOT NULL,
      UNIQUE (SellerName, SellerProductId)
    );
  `);
  database.close();
}

function withRepository<T>(operation: (repository: CatalogRepository) => T): T {
  const databasePath = createDatabasePath();
  createSchema(databasePath);
  const repository = createCatalogRepository(databasePath);

  try {
    return operation(repository);
  } finally {
    repository.close();
    unlinkSync(databasePath);
  }
}

function product(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    Id: `seller-${randomUUID()}`,
    SellerName: "Seller",
    Name: "Product",
    Brand: "Brand",
    Category: "Category",
    ...overrides,
  };
}

describe("importProducts", () => {
  it("matches an existing product and creates its offer", () => {
    withRepository((repository) => {
      const productId = repository.insertProduct({
        Name: "MacBook Air M2",
        Brand: "Apple",
        Category: "Computers",
      });

      const summary = importProducts(repository, [
        product({
          Id: "seller-product-1",
          SellerName: "MegaStore",
          Name: "MacBook Air  M2",
          Brand: "Apple",
          Category: "Computers",
        }),
      ]);

      expect(summary).toEqual({
        read: 1,
        productsMatched: 1,
        productsCreated: 0,
        dedupedWithinFile: 0,
        offersCreated: 1,
        offersSkipped: 0,
        categoryConflicts: 0,
        items: [
          {
            sellerName: "MegaStore",
            sellerProductId: "seller-product-1",
            name: "MacBook Air  M2",
            productAction: "matched",
            productId,
            offerAction: "created",
            categoryConflict: false,
          },
        ],
      });
      expect(repository.listProducts()).toHaveLength(1);
      expect(productId).toBe(1);
    });
  });

  it("creates one product and reuses it for duplicate keys in the input", () => {
    withRepository((repository) => {
      const summary = importProducts(repository, [
        product({ Id: "seller-product-1", SellerName: "Seller A" }),
        product({
          Id: "seller-product-2",
          SellerName: "Seller B",
          Name: " product ",
        }),
      ]);

      expect(summary.productsCreated).toBe(1);
      expect(summary.dedupedWithinFile).toBe(1);
      expect(summary.offersCreated).toBe(2);
      expect(repository.listProducts()).toHaveLength(1);
    });
  });

  it("counts category conflicts without replacing the canonical product", () => {
    withRepository((repository) => {
      repository.insertProduct({
        Name: "Camera Canon EOS R6",
        Brand: "Canon",
        Category: "Photography",
      });

      const summary = importProducts(repository, [
        product({
          Name: "Camera Canon EOS R6",
          Brand: "Canon",
          Category: "Photo",
        }),
      ]);

      expect(summary.categoryConflicts).toBe(1);
      expect(repository.listProducts()[0]?.Category).toBe("Photography");
    });
  });

  it("rejects conflicting source IDs before writing", () => {
    withRepository((repository) => {
      expect(() =>
        importProducts(repository, [
          product({ Id: "same-id", Name: "Product A" }),
          product({ Id: "same-id", Name: "Product B" }),
        ]),
      ).toThrow(SourceIdConflictError);

      expect(repository.listProducts()).toEqual([]);
    });
  });

  it("rolls back all writes during a dry run", () => {
    withRepository((repository) => {
      const summary = importProducts(
        repository,
        [product({ Id: "dry-run-id" })],
        { dryRun: true },
      );

      expect(summary.productsCreated).toBe(1);
      expect(summary.offersCreated).toBe(1);
      expect(repository.listProducts()).toEqual([]);
    });
  });

  it("is idempotent when importing the same offer twice", () => {
    withRepository((repository) => {
      const input = [product({ Id: "same-id" })];

      const first = importProducts(repository, input);
      const second = importProducts(repository, input);

      expect(first.offersCreated).toBe(1);
      expect(second.offersCreated).toBe(0);
      expect(second.offersSkipped).toBe(1);
      expect(repository.listProducts()).toHaveLength(1);
    });
  });
});
