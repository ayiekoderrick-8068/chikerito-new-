export const FALLBACK_CURRENCIES = Object.freeze([
  { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", minorUnits: 2 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", minorUnits: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnits: 0 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minorUnits: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", minorUnits: 2 },
]);

export function normalizeCurrency(code, fallback = "USD") {
  const normalized = String(code || fallback).toUpperCase();
  return FALLBACK_CURRENCIES.some((currency) => currency.code === normalized) ? normalized : fallback;
}

export function currencyMetadata(code) {
  const normalized = normalizeCurrency(code);
  return FALLBACK_CURRENCIES.find((currency) => currency.code === normalized) || FALLBACK_CURRENCIES[0];
}

export function formatMoney(amount, code = "USD", { showCode = false } = {}) {
  const currency = normalizeCurrency(code);
  const metadata = currencyMetadata(currency);
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 0 : metadata.minorUnits,
      maximumFractionDigits: metadata.minorUnits,
      currencyDisplay: showCode ? "code" : "symbol",
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(metadata.minorUnits)}`;
  }
}

export function moneyView(record, fallbackCurrency = "USD") {
  const money = record?.money || {};
  return {
    originalAmount: money.originalAmount ?? record?.original_amount ?? record?.amount ?? 0,
    currency: normalizeCurrency(money.currency ?? record?.currency, fallbackCurrency),
    exchangeRate: money.exchangeRate ?? record?.exchange_rate ?? 1,
    baseAmount: money.baseAmount ?? record?.base_amount ?? record?.amount ?? 0,
    baseCurrency: normalizeCurrency(money.baseCurrency ?? record?.base_currency, fallbackCurrency),
    converted: money.converted ?? false,
  };
}

export function conversionLabel(record, fallbackCurrency = "USD") {
  const money = moneyView(record, fallbackCurrency);
  if (!money.converted && money.currency === money.baseCurrency) return "";
  return `${formatMoney(money.baseAmount, money.baseCurrency, { showCode: true })} at ${money.exchangeRate}`;
}
