export type ProductInput = {
  Id: string;
  SellerName: string;
  Name: string;
  Brand: string | null;
  Category: string | null;
};

export class InputValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid input: ${issues.join("; ")}`);
    this.name = "InputValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  index: number,
  issues: string[],
): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`Record ${index}: ${field} must be a non-empty string`);
    return "";
  }

  return value;
}

function nullableString(
  value: unknown,
  field: string,
  index: number,
  issues: string[],
): string | null {
  if (value !== null && typeof value !== "string") {
    issues.push(`Record ${index}: ${field} must be a string or null`);
    return null;
  }

  return value;
}

export function parseProducts(input: unknown): ProductInput[] {
  if (!Array.isArray(input)) {
    throw new InputValidationError(["Input must be an array"]);
  }

  if (input.length === 0) {
    throw new InputValidationError(["Input must contain at least one product"]);
  }

  const issues: string[] = [];
  const products: ProductInput[] = [];

  input.forEach((value, index) => {
    if (!isRecord(value)) {
      issues.push(`Record ${index}: must be an object`);
      return;
    }

    products.push({
      Id: requiredString(value.Id, "Id", index, issues),
      SellerName: requiredString(value.SellerName, "SellerName", index, issues),
      Name: requiredString(value.Name, "Name", index, issues),
      Brand: nullableString(value.Brand, "Brand", index, issues),
      Category: nullableString(value.Category, "Category", index, issues),
    });
  });

  if (issues.length > 0) {
    throw new InputValidationError(issues);
  }

  return products;
}

export function parseProductsJson(json: string): ProductInput[] {
  let input: unknown;

  try {
    input = JSON.parse(json) as unknown;
  } catch {
    throw new InputValidationError(["Input is not valid JSON"]);
  }

  return parseProducts(input);
}
