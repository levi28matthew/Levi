/**
 * Money arithmetic.
 *
 * Authoritative financial values are always **integer minor units** (cents, pence,
 * paise …) plus an ISO-4217 currency code. Binary floating point is never used for a
 * total, a balance or a budget — `0.1 + 0.2` style drift is impossible by construction.
 * The same representation is stored in Postgres as `numeric`/`bigint` minor units, so
 * the browser and the database agree exactly.
 */

export interface Money {
  /** Signed amount in minor units. `-1250` is −12.50 in a 2-decimal currency. */
  amountMinor: number;
  /** ISO-4217 code, upper case. */
  currency: string;
}

/** Minor-unit exponent per currency. Defaults to 2 for unknown codes. */
const CURRENCY_EXPONENT: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
  CLF: 4,
  UYW: 4,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENT[normalizeCurrency(currency)] ?? 2;
}

export function normalizeCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`"${currency}" is not a valid ISO-4217 currency code.`);
  return code;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new Error("Money amounts must be safe integers in minor units.");
  return { amountMinor, currency: normalizeCurrency(currency) };
}

export function zero(currency: string): Money {
  return money(0, currency);
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`Cannot combine ${left.currency} and ${right.currency} without an explicit conversion.`);
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor + right.amountMinor, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function negateMoney(value: Money): Money {
  return money(-value.amountMinor, value.currency);
}

export function sumMoney(values: readonly Money[]): Money | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => addMoney(total, value));
}

/**
 * Parse a human-entered decimal string into minor units **exactly**, without ever
 * converting through a float. Throws on malformed input or unsupported precision.
 */
export function parseMoney(input: string, currency: string): Money {
  const code = normalizeCurrency(currency);
  const exponent = currencyExponent(code);
  const cleaned = input.trim().replace(/[\s\u00a0,]/g, "").replace(/^\+/, "");
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new Error(`"${input}" is not a valid amount.`);
  }
  const [, sign, whole = "", fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new Error(`${code} supports at most ${exponent} decimal place(s).`);
  }
  const padded = fraction.padEnd(exponent, "0");
  const digits = `${whole || "0"}${padded}`;
  const amountMinor = Number(digits);
  if (!Number.isSafeInteger(amountMinor)) throw new Error(`"${input}" is out of range.`);
  return money(sign === "-" ? -amountMinor : amountMinor, code);
}

/** Exact rendering of minor units as a plain decimal string, e.g. `-1250` → `"-12.50"`. */
export function toDecimalString(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amountMinor < 0;
  const digits = Math.abs(value.amountMinor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent) || "0";
  const fraction = exponent === 0 ? "" : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * Locale-aware display. Grouping is applied to the integer part only, so no float
 * ever touches the value.
 */
export function formatMoney(value: Money, locale = "en-US"): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amountMinor < 0;
  const digits = Math.abs(value.amountMinor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent) || "0";
  const fraction = exponent === 0 ? "" : digits.slice(digits.length - exponent);

  // Grouping applies to the integer part only, so no float ever touches the value.
  const grouped = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(Number(whole));

  const decimalSeparator = exponent === 0 ? "" : new Intl.NumberFormat(locale).format(1.1).replace(/\d/g, "");
  const suffix = exponent === 0 ? "" : `${decimalSeparator}${fraction}`;
  const sign = negative ? "-" : "";
  const symbol = currencySymbol(value.currency, locale);
  return symbol.prefix ? `${sign}${symbol.text}${grouped}${suffix}` : `${sign}${grouped}${suffix} ${symbol.text}`;
}

/** Where this locale places the currency marker (all Intl data, no hard-coded guesses). */
function currencySymbol(currency: string, locale: string): { text: string; prefix: boolean } {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  });
  const parts = formatter.formatToParts(1234);
  const symbolIndex = parts.findIndex((part) => part.type === "currency");
  const numberIndex = parts.findIndex((part) => part.type === "integer");
  const text = parts.filter((part) => part.type === "currency").map((part) => part.value).join("") || currency;
  return { text, prefix: symbolIndex !== -1 && (numberIndex === -1 || symbolIndex < numberIndex) };
}

export type TransactionType = "income" | "expense";

/** Signed amount for a ledger entry: income increases the balance, expense decreases it. */
export function signedAmount(type: TransactionType, magnitude: Money): Money {
  return type === "expense" ? negateMoney(magnitude) : magnitude;
}

export interface BudgetUsage {
  limit: Money;
  spent: Money;
  remaining: Money;
  /** 0–100+, rounded. Over 100 means the budget is exceeded. */
  usedPercent: number;
  exceeded: boolean;
}

/** Budget consumption. A zero limit is treated as "no budget" rather than a divide-by-zero. */
export function budgetUsage(limit: Money, spent: Money): BudgetUsage {
  assertSameCurrency(limit, spent);
  const remaining = subtractMoney(limit, spent);
  const usedPercent = limit.amountMinor <= 0 ? 0 : Math.round((spent.amountMinor / limit.amountMinor) * 100);
  return { limit, spent, remaining, usedPercent, exceeded: spent.amountMinor > limit.amountMinor };
}

/** Group signed amounts by key, preserving integer arithmetic. */
export function sumByCategory<T extends { amountMinor: number; currency: string }>(
  entries: readonly T[],
  key: (entry: T) => string,
  currency: string,
): Map<string, Money> {
  const code = normalizeCurrency(currency);
  const totals = new Map<string, Money>();
  for (const entry of entries) {
    if (normalizeCurrency(entry.currency) !== code) {
      throw new Error(`Cannot sum ${entry.currency} entries into a ${code} total.`);
    }
    const bucket = key(entry);
    totals.set(bucket, addMoney(totals.get(bucket) ?? zero(code), money(entry.amountMinor, code)));
  }
  return totals;
}
