import { matchKey, normalize } from "./normalize.js";
import type { ProductInput } from "./reader.js";
import type { CatalogProduct, CatalogRepository } from "./repository.js";

export type ImportSummary = {
  read: number;
  productsMatched: number;
  productsCreated: number;
  dedupedWithinFile: number;
  offersCreated: number;
  offersSkipped: number;
  categoryConflicts: number;
};

export type ImportItemResult = {
  sellerName: string;
  sellerProductId: string;
  name: string;
  productAction: "matched" | "created" | "deduplicated";
  productId: number;
  offerAction: "created" | "skipped";
  categoryConflict: boolean;
};

export type ImportResult = ImportSummary & {
  items: ImportItemResult[];
};

export class SourceIdConflictError extends Error {
  constructor(sellerName: string, sellerProductId: string) {
    super(
      `Conflicting products for SellerName + SellerProductId: ${sellerName} + ${sellerProductId}`,
    );
    this.name = "SourceIdConflictError";
  }
}

type SourceProduct = Pick<ProductInput, "Name" | "Brand" | "Category">;

function sourceProductKey(product: SourceProduct): string {
  return JSON.stringify([
    matchKey(product.Name, product.Brand),
    normalize(product.Category),
  ]);
}

function validateSourceIdConflicts(products: ProductInput[]): void {
  const seen = new Map<string, string>();

  for (const product of products) {
    const key = `${product.SellerName}\u0000${product.Id}`;
    const currentProductKey = sourceProductKey(product);
    const previousProductKey = seen.get(key);

    if (previousProductKey === undefined) {
      seen.set(key, currentProductKey);
      continue;
    }

    if (previousProductKey !== currentProductKey) {
      throw new SourceIdConflictError(product.SellerName, product.Id);
    }
  }
}

function createProductIndex(
  products: CatalogProduct[],
): Map<string, CatalogProduct> {
  const index = new Map<string, CatalogProduct>();

  for (const product of products) {
    const key = matchKey(product.Name, product.Brand);
    const existing = index.get(key);

    if (existing === undefined || product.Id < existing.Id) {
      index.set(key, product);
    }
  }

  return index;
}

class DryRunRollback extends Error {
  constructor() {
    super("Dry run rollback");
  }
}

export function importProducts(
  repository: CatalogRepository,
  products: ProductInput[],
  options: { dryRun?: boolean } = {},
): ImportResult {
  validateSourceIdConflicts(products);

  const summary: ImportSummary = {
    read: products.length,
    productsMatched: 0,
    productsCreated: 0,
    dedupedWithinFile: 0,
    offersCreated: 0,
    offersSkipped: 0,
    categoryConflicts: 0,
  };
  const items: ImportItemResult[] = [];

  try {
    repository.transaction(() => {
      const productIndex = createProductIndex(repository.listProducts());
      const createdKeys = new Set<string>();

      for (const input of products) {
        const key = matchKey(input.Name, input.Brand);
        let catalogProduct = productIndex.get(key);
        let productAction: ImportItemResult["productAction"];
        let categoryConflict = false;

        if (catalogProduct !== undefined) {
          if (createdKeys.has(key)) {
            productAction = "deduplicated";
            summary.dedupedWithinFile += 1;
          } else {
            productAction = "matched";
            summary.productsMatched += 1;
            categoryConflict =
              normalize(input.Category) !== normalize(catalogProduct.Category);

            if (categoryConflict) {
              summary.categoryConflicts += 1;
            }
          }
        } else {
          const productId = repository.insertProduct({
            Name: input.Name,
            Brand: input.Brand,
            Category: input.Category,
          });
          catalogProduct = {
            Id: productId,
            Name: input.Name,
            Brand: input.Brand,
            Category: input.Category,
          };
          productIndex.set(key, catalogProduct);
          createdKeys.add(key);
          summary.productsCreated += 1;
          productAction = "created";
        }

        const offerCreated = repository.insertOffer({
          SellerName: input.SellerName,
          ProductId: catalogProduct.Id,
          SellerProductId: input.Id,
        });
        const offerAction = offerCreated ? "created" : "skipped";

        if (offerCreated) {
          summary.offersCreated += 1;
        } else {
          summary.offersSkipped += 1;
        }

        items.push({
          sellerName: input.SellerName,
          sellerProductId: input.Id,
          name: input.Name,
          productAction,
          productId: catalogProduct.Id,
          offerAction,
          categoryConflict,
        });
      }

      if (options.dryRun) {
        throw new DryRunRollback();
      }
    });
  } catch (error) {
    if (!(options.dryRun && error instanceof DryRunRollback)) {
      throw error;
    }
  }

  return { ...summary, items };
}
