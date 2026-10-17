import { describe, expect, it } from "vitest";
import {
  addMoney,
  budgetUsage,
  formatMoney,
  money,
  parseMoney,
  signedAmount,
  subtractMoney,
  sumByCategory,
  sumMoney,
  toDecimalString,
} from "./finance";

describe("money parsing", () => {
  it("parses decimal input into exact minor units", () => {
    expect(parseMoney("12.34", "USD")).toEqual({ amountMinor: 1234, currency: "USD" });
    expect(parseMoney("  -0.05 ", "usd")).toEqual({ amountMinor: -5, currency: "USD" });
    expect(parseMoney("1,234.5", "USD")).toEqual({ amountMinor: 123450, currency: "USD" });
    expect(parseMoney("7", "USD")).toEqual({ amountMinor: 700, currency: "USD" });
    expect(parseMoney(".5", "USD")).toEqual({ amountMinor: 50, currency: "USD" });
  });

  it("respects currency-specific precision", () => {
    expect(parseMoney("500", "JPY")).toEqual({ amountMinor: 500, currency: "JPY" });
    expect(() => parseMoney("500.1", "JPY")).toThrow("at most 0 decimal");
    expect(parseMoney("1.234", "KWD").amountMinor).toBe(1234);
  });

  it("rejects malformed and unsafe input", () => {
    expect(() => parseMoney("", "USD")).toThrow("not a valid amount");
    expect(() => parseMoney("abc", "USD")).toThrow("not a valid amount");
    expect(() => parseMoney("1.234", "USD")).toThrow("at most 2 decimal");
    expect(() => parseMoney("1", "US")).toThrow("ISO-4217");
    expect(() => money(1.5, "USD")).toThrow("safe integers");
  });
});

describe("money arithmetic is exact", () => {
  it("does not suffer binary floating point drift", () => {
    const total = addMoney(parseMoney("0.1", "USD"), parseMoney("0.2", "USD"));
    expect(total.amountMinor).toBe(30);
    expect(toDecimalString(total)).toBe("0.30");
    expect(toDecimalString(total)).not.toBe("0.30000000000000004");
  });

  it("sums many values without accumulating error", () => {
    const values = Array.from({ length: 1000 }, () => parseMoney("0.01", "USD"));
    expect(sumMoney(values)?.amountMinor).toBe(1000);
  });

  it("refuses to mix currencies silently", () => {
    expect(() => addMoney(money(100, "USD"), money(100, "EUR"))).toThrow("Cannot combine");
  });

  it("computes balances and budgets from signed minor units", () => {
    const balance = addMoney(signedAmount("income", parseMoney("2500.00", "USD")), signedAmount("expense", parseMoney("49.99", "USD")));
    expect(toDecimalString(balance)).toBe("2450.01");

    const usage = budgetUsage(parseMoney("500.00", "USD"), parseMoney("650.00", "USD"));
    expect(usage.exceeded).toBe(true);
    expect(usage.usedPercent).toBe(130);
    expect(toDecimalString(usage.remaining)).toBe("-150.00");
  });

  it("never divides by a zero budget", () => {
    const usage = budgetUsage(money(0, "USD"), money(500, "USD"));
    expect(usage.usedPercent).toBe(0);
    expect(usage.exceeded).toBe(true);
  });

  it("formats round-trip without losing precision", () => {
    expect(formatMoney(parseMoney("1234567.89", "USD"), "en-US")).toBe("$1,234,567.89");
    expect(formatMoney(parseMoney("-0.05", "USD"), "en-US")).toBe("-$0.05");
    expect(toDecimalString(parseMoney("1234567.89", "USD"))).toBe("1234567.89");
  });

  it("groups category totals by currency", () => {
    const entries = [
      { amountMinor: -1250, currency: "USD", category: "food" },
      { amountMinor: -750, currency: "USD", category: "food" },
      { amountMinor: -2000, currency: "USD", category: "rent" },
    ];
    const totals = sumByCategory(entries, (entry) => entry.category, "USD");
    expect(toDecimalString(totals.get("food")!)).toBe("-20.00");
    expect(toDecimalString(totals.get("rent")!)).toBe("-20.00");
  });

  it("subtracts exactly and returns null for an empty sum", () => {
    expect(toDecimalString(subtractMoney(parseMoney("100", "USD"), parseMoney("33.33", "USD")))).toBe("66.67");
    expect(sumMoney([])).toBeNull();
  });
});
