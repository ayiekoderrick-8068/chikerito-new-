import { describe, expect, it } from "vitest";
import {
  FALLBACK_CURRENCIES,
  normalizeCurrency,
  currencyMetadata,
  formatMoney,
  moneyView,
  conversionLabel,
} from "../src/currency.js";

describe("currency metadata", () => {
  it("offers the approved currencies in deterministic order", () => {
    expect(FALLBACK_CURRENCIES.map((currency) => currency.code)).toEqual(["USD", "EUR", "GBP", "KES", "JPY", "CAD", "AUD"]);
  });

  it("has unique codes", () => {
    expect(new Set(FALLBACK_CURRENCIES.map((currency) => currency.code)).size).toBe(FALLBACK_CURRENCIES.length);
  });

  it("has names and symbols for every currency", () => {
    FALLBACK_CURRENCIES.forEach((currency) => {
      expect(currency.name.length).toBeGreaterThan(2);
      expect(currency.symbol.length).toBeGreaterThan(0);
    });
  });

  it("declares JPY as a zero-decimal currency", () => {
    expect(currencyMetadata("JPY").minorUnits).toBe(0);
  });

  it.each(["USD", "EUR", "GBP", "KES", "CAD", "AUD"])("declares %s with two minor units", (code) => {
    expect(currencyMetadata(code).minorUnits).toBe(2);
  });
});

describe("normalizeCurrency", () => {
  it("uppercases a supported currency", () => {
    expect(normalizeCurrency("kes")).toBe("KES");
  });

  it("defaults an omitted code to USD", () => {
    expect(normalizeCurrency()).toBe("USD");
  });

  it("uses a supplied fallback for an omitted code", () => {
    expect(normalizeCurrency(null, "EUR")).toBe("EUR");
  });

  it("uses the fallback for an unsupported code", () => {
    expect(normalizeCurrency("BTC", "GBP")).toBe("GBP");
  });

  it("returns metadata for a lower-case code", () => {
    expect(currencyMetadata("eur")).toEqual(expect.objectContaining({ code: "EUR", symbol: "€" }));
  });
});

describe("formatMoney", () => {
  it("formats USD with its symbol", () => {
    expect(formatMoney(1200, "USD")).toMatch(/\$1,200/);
  });

  it("formats EUR with its symbol", () => {
    expect(formatMoney(1200, "EUR")).toMatch(/€1,200|1,200 €/);
  });

  it("formats KES without assuming a dollar symbol", () => {
    expect(formatMoney(2500, "KES")).toMatch(/KSh|KES/);
  });

  it("shows a currency code when requested", () => {
    expect(formatMoney(25, "CAD", { showCode: true })).toMatch(/CAD/);
  });

  it("preserves cents for fractional values", () => {
    expect(formatMoney(12.5, "USD")).toMatch(/12\.50/);
  });

  it("does not invent decimals for JPY", () => {
    expect(formatMoney(125, "JPY")).not.toMatch(/\.00/);
  });

  it("renders non-numeric input as zero", () => {
    expect(formatMoney("not-money", "USD")).toMatch(/\$0/);
  });
});

describe("moneyView backward compatibility", () => {
  it("reads the nested API representation", () => {
    expect(moneyView({ money: { originalAmount: 10, currency: "EUR", exchangeRate: 1.2, baseAmount: 12, baseCurrency: "USD", converted: true } })).toEqual({
      originalAmount: 10,
      currency: "EUR",
      exchangeRate: 1.2,
      baseAmount: 12,
      baseCurrency: "USD",
      converted: true,
    });
  });

  it("reads persisted snake-case fields", () => {
    expect(moneyView({ original_amount: 10, currency: "GBP", exchange_rate: 1.25, base_amount: 12.5, base_currency: "USD" })).toEqual({
      originalAmount: 10,
      currency: "GBP",
      exchangeRate: 1.25,
      baseAmount: 12.5,
      baseCurrency: "USD",
      converted: false,
    });
  });

  it("treats an old amount-only row as base currency", () => {
    expect(moneyView({ amount: 45 }, "KES")).toEqual({
      originalAmount: 45,
      currency: "KES",
      exchangeRate: 1,
      baseAmount: 45,
      baseCurrency: "KES",
      converted: false,
    });
  });

  it("lets nested values take precedence over storage fields", () => {
    const view = moneyView({ amount: 5, currency: "USD", money: { originalAmount: 20, currency: "EUR", baseAmount: 22, baseCurrency: "USD" } });
    expect(view.originalAmount).toBe(20);
    expect(view.currency).toBe("EUR");
  });

  it("falls back safely when a record is absent", () => {
    expect(moneyView(null, "CAD")).toEqual(expect.objectContaining({ originalAmount: 0, baseAmount: 0, currency: "CAD", baseCurrency: "CAD" }));
  });
});

describe("conversionLabel", () => {
  it("is empty for an ordinary single-currency row", () => {
    expect(conversionLabel({ amount: 100 }, "USD")).toBe("");
  });

  it("includes normalized currency and stored rate for a conversion", () => {
    const label = conversionLabel({ money: { originalAmount: 10, currency: "EUR", exchangeRate: 1.25, baseAmount: 12.5, baseCurrency: "USD", converted: true } });
    expect(label).toMatch(/USD/);
    expect(label).toMatch(/12\.50/);
    expect(label).toMatch(/at 1\.25/);
  });

  it("shows conversion when currency and baseCurrency differ even without a converted flag", () => {
    expect(conversionLabel({ currency: "GBP", amount: 10, exchange_rate: 2, base_amount: 20, base_currency: "KES" }, "KES")).toMatch(/KES/);
  });
});
