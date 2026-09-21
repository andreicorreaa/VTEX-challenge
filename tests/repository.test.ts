import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createCatalogRepository } from "../src/repository.js";

function createDatabasePath(): string {
  return join(tmpdir(), `catalog-consolidation-${randomUUID()}.db`);
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

describe("createCatalogRepository", () => {
  it("enables foreign keys on its connection", () => {
    const databasePath = createDatabasePath();
    createSchema(databasePath);
    const repository = createCatalogRepository(databasePath);

    try {
      expect(repository.foreignKeysEnabled()).toBe(true);
    } finally {
      repository.close();
      unlinkSync(databasePath);
    }
  });

  it("inserts products and preserves nullable fields", () => {
    const databasePath = createDatabasePath();
    createSchema(databasePath);
    const repository = createCatalogRepository(databasePath);

    const productId = repository.insertProduct({
      Name: "Cable Organizer Kit",
      Brand: null,
      Category: "Accessories",
    });

    expect(repository.listProducts()).toEqual([
      {
        Id: productId,
        Name: "Cable Organizer Kit",
        Brand: null,
        Category: "Accessories",
      },
    ]);
    repository.close();
    unlinkSync(databasePath);
  });

  it("creates an offer once and ignores duplicate offers", () => {
    const databasePath = createDatabasePath();
    createSchema(databasePath);
    const repository = createCatalogRepository(databasePath);
    const productId = repository.insertProduct({
      Name: "Product",
      Brand: "Brand",
      Category: "Category",
    });

    const offer = {
      SellerName: "Seller",
      ProductId: productId,
      SellerProductId: "000123-not-a-uuid",
    };

    expect(repository.insertOffer(offer)).toBe(true);
    expect(repository.insertOffer(offer)).toBe(false);
    repository.close();
    unlinkSync(databasePath);
  });

  it("stores a malicious brand as a literal value", () => {
    const databasePath = createDatabasePath();
    createSchema(databasePath);
    const repository = createCatalogRepository(databasePath);
    const brand = "TestBrand'; DROP TABLE Product; --";

    const productId = repository.insertProduct({
      Name: "Security Test Product",
      Brand: brand,
      Category: "Electronics",
    });

    expect(repository.listProducts()).toEqual([
      {
        Id: productId,
        Name: "Security Test Product",
        Brand: brand,
        Category: "Electronics",
      },
    ]);
    repository.close();
    unlinkSync(databasePath);
  });

  it("rolls back all writes when the transaction fails", () => {
    const databasePath = createDatabasePath();
    createSchema(databasePath);
    const repository = createCatalogRepository(databasePath);

    expect(() =>
      repository.transaction(() => {
        repository.insertProduct({
          Name: "Product written before failure",
          Brand: "Brand",
          Category: "Category",
        });
        throw new Error("forced failure");
      }),
    ).toThrow("forced failure");

    expect(repository.listProducts()).toEqual([]);
    repository.close();
    unlinkSync(databasePath);
  });

  it("rejects offers that reference a missing product", () => {
    const databasePath = createDatabasePath();
    createSchema(databasePath);
    const repository = createCatalogRepository(databasePath);

    expect(() =>
      repository.insertOffer({
        SellerName: "Seller",
        ProductId: 999,
        SellerProductId: "seller-id",
      }),
    ).toThrow();
    repository.close();
    unlinkSync(databasePath);
  });
});
