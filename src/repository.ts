import Database from "better-sqlite3";

export type CatalogProduct = {
  Id: number;
  Name: string;
  Brand: string | null;
  Category: string | null;
};

export type SellerOffer = {
  SellerName: string;
  ProductId: number;
  SellerProductId: string;
};

export type CatalogRepository = {
  listProducts(): CatalogProduct[];
  insertProduct(product: Omit<CatalogProduct, "Id">): number;
  insertOffer(offer: SellerOffer): boolean;
  transaction<T>(operation: () => T): T;
  foreignKeysEnabled(): boolean;
  close(): void;
};

export function createCatalogRepository(
  databasePath: string,
): CatalogRepository {
  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");

  const listProductsStatement = database.prepare(
    "SELECT Id, Name, Brand, Category FROM Product ORDER BY Id",
  );
  const insertProductStatement = database.prepare(
    "INSERT INTO Product (Name, Brand, Category) VALUES (@name, @brand, @category)",
  );
  const insertOfferStatement = database.prepare(`
    INSERT INTO SellerProduct (SellerName, ProductId, SellerProductId)
    VALUES (@sellerName, @productId, @sellerProductId)
    ON CONFLICT (SellerName, SellerProductId) DO NOTHING
  `);
  const foreignKeysStatement = database.prepare("PRAGMA foreign_keys");

  return {
    listProducts(): CatalogProduct[] {
      return listProductsStatement.all() as CatalogProduct[];
    },

    insertProduct(product): number {
      const result = insertProductStatement.run({
        name: product.Name,
        brand: product.Brand,
        category: product.Category,
      });

      return Number(result.lastInsertRowid);
    },

    insertOffer(offer): boolean {
      const result = insertOfferStatement.run({
        sellerName: offer.SellerName,
        productId: offer.ProductId,
        sellerProductId: offer.SellerProductId,
      });

      return result.changes === 1;
    },

    transaction<T>(operation: () => T): T {
      return database.transaction(operation)();
    },

    foreignKeysEnabled(): boolean {
      const result = foreignKeysStatement.get() as { foreign_keys: number };
      return result.foreign_keys === 1;
    },

    close(): void {
      database.close();
    },
  };
}
