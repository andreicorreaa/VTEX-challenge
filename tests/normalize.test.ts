import { describe, expect, it } from "vitest";
import { matchKey, normalize } from "../src/normalize.js";

describe("normalize", () => {
  it("normalizes case, whitespace, and accents", () => {
    expect(normalize("  Câmera   Canon EOS R6  ")).toBe("camera canon eos r6");
  });

  it("removes quotation marks without adding spaces", () => {
    expect(normalize("Tablet iPad Pro 12.9''")).toBe("tablet ipad pro 12.9");
    expect(normalize('Monitor LG UltraWide 34"')).toBe(
      "monitor lg ultrawide 34",
    );
  });

  it("converts separators to spaces", () => {
    expect(normalize("Wi-Fi/6_router")).toBe("wi fi 6 router");
  });

  it("preserves decimal points between digits", () => {
    expect(normalize("Version 12.9.1")).toBe("version 12.9.1");
  });

  it("removes punctuation outside decimal numbers", () => {
    expect(normalize("Brand: Test; Product, 2.4GHz!")).toBe(
      "brand test product 2.4ghz",
    );
  });

  it("normalizes null and undefined as empty strings", () => {
    expect(normalize(null)).toBe("");
    expect(normalize(undefined)).toBe("");
  });
});

describe("matchKey", () => {
  it("separates normalized name and brand with a null character", () => {
    expect(matchKey("MacBook Air  M2", "Apple")).toBe(
      "macbook air m2\u0000apple",
    );
  });

  it("keeps a missing brand in its own bucket", () => {
    expect(matchKey("Cable Organizer Kit", null)).toBe(
      "cable organizer kit\u0000",
    );
    expect(matchKey("Cable Organizer Kit", "")).toBe(
      "cable organizer kit\u0000",
    );
  });
});
