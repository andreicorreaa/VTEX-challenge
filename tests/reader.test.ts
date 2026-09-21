import { describe, expect, it } from "vitest";
import {
  InputValidationError,
  parseProducts,
  parseProductsJson,
} from "../src/reader.js";

describe("parseProductsJson", () => {
  it("parses a valid product list", () => {
    const products = parseProductsJson(
      JSON.stringify([
        {
          Id: "seller-id-001",
          SellerName: "Example Seller",
          Name: "Example Product",
          Brand: null,
          Category: "Example Category",
        },
      ]),
    );

    expect(products).toEqual([
      {
        Id: "seller-id-001",
        SellerName: "Example Seller",
        Name: "Example Product",
        Brand: null,
        Category: "Example Category",
      },
    ]);
  });

  it("preserves arbitrary seller IDs", () => {
    const [product] = parseProductsJson(
      JSON.stringify([
        {
          Id: "000123-not-a-uuid",
          SellerName: "Seller",
          Name: "Product",
          Brand: "Brand",
          Category: null,
        },
      ]),
    );

    expect(product?.Id).toBe("000123-not-a-uuid");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseProductsJson("not-json")).toThrow(InputValidationError);
  });
});

describe("parseProducts", () => {
  it("rejects an empty input", () => {
    expect(() => parseProducts([])).toThrow(
      "Input must contain at least one product",
    );
  });

  it("rejects missing required fields", () => {
    expect(() =>
      parseProducts([
        {
          Id: "id",
          SellerName: "",
          Name: 42,
          Brand: null,
          Category: null,
        },
      ]),
    ).toThrow(InputValidationError);
  });

  it("rejects invalid nullable fields", () => {
    expect(() =>
      parseProducts([
        {
          Id: "id",
          SellerName: "Seller",
          Name: "Product",
          Brand: 123,
          Category: false,
        },
      ]),
    ).toThrow(InputValidationError);
  });

  it("rejects non-object records", () => {
    expect(() => parseProducts([null])).toThrow(InputValidationError);
  });
});
