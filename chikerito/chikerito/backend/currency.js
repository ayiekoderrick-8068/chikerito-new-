const SUPPORTED_CURRENCIES = Object.freeze([
  { code: "USD", name: "US Dollar", symbol: "$", minorUnits: 2 },
  { code: "EUR", name: "Euro", symbol: "€", minorUnits: 2 },
  { code: "GBP", name: "British Pound", symbol: "£", minorUnits: 2 },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", minorUnits: 2 },
  { code: "JPY", name: "Japanese Yen", symbol: "¥", minorUnits: 0 },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", minorUnits: 2 },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", minorUnits: 2 },
]);

const CURRENCY_BY_CODE = new Map(SUPPORTED_CURRENCIES.map((currency) => [currency.code, currency]));

// Server-owned reference values expressed as USD per currency unit. Pair
// rates are derived from this table; request payloads never influence them.
const USD_REFERENCE_VALUES = Object.freeze({
  USD: 1,
  EUR: 1.25,
  GBP: 1.3,
  KES: 0.0077,
  JPY: 0.0067,
  CAD: 0.74,
  AUD: 0.66,
});
const RATE_TABLE_VERSION = "2026-08-19";

function currencyCode(value, fallback = "USD") {
  const code = String(value || fallback).trim().toUpperCase();
  return CURRENCY_BY_CODE.has(code) ? code : null;
}

function currencyError(value) {
  return `Unsupported currency: ${String(value || "").trim().toUpperCase() || "(empty)"}`;
}

function roundForCurrency(value, code) {
  const metadata = CURRENCY_BY_CODE.get(code) || CURRENCY_BY_CODE.get("USD");
  const factor = 10 ** metadata.minorUnits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function positiveMoney(value, field = "amount") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return { error: `${field} must be a positive number` };
  return { value: number };
}

function exchangeRateFor(transactionCurrency, baseCurrency) {
  const transaction = currencyCode(transactionCurrency);
  const base = currencyCode(baseCurrency);
  if (!transaction || !base) return null;
  return transaction === base ? 1 : USD_REFERENCE_VALUES[transaction] / USD_REFERENCE_VALUES[base];
}

// exchangeRate always means "base-currency units for one transaction-currency
// unit". Storing this snapshot makes later calculations repeatable and keeps
// the original transaction value intact.
function normalizeTransaction({ amount, currency }, lifeSpace, field = "amount") {
  const money = positiveMoney(amount, field);
  if (money.error) return money;
  const baseCurrency = currencyCode(lifeSpace?.currency) || "USD";
  const transactionCurrency = currencyCode(currency, baseCurrency);
  if (!transactionCurrency) return { error: currencyError(currency) };

  const rate = exchangeRateFor(transactionCurrency, baseCurrency);

  const originalAmount = roundForCurrency(money.value, transactionCurrency);
  return {
    originalAmount,
    currency: transactionCurrency,
    exchangeRate: rate,
    baseAmount: roundForCurrency(originalAmount * rate, baseCurrency),
    baseCurrency,
  };
}

function monetaryFields(normalized, prefix = "") {
  const key = (name) => prefix ? `${prefix}_${name}` : name;
  return {
    [key("original_amount")]: normalized.originalAmount,
    [key("currency")]: normalized.currency,
    [key("exchange_rate")]: normalized.exchangeRate,
    [key("base_amount")]: normalized.baseAmount,
    [key("base_currency")]: normalized.baseCurrency,
  };
}

function baseAmount(record, fallbackCurrency = "USD", prefix = "") {
  const key = (name) => prefix ? `${prefix}_${name}` : name;
  const stored = Number(record?.[key("base_amount")]);
  if (Number.isFinite(stored)) return stored;
  const legacy = Number(record?.[prefix ? `${prefix}_amount` : "amount"]);
  return roundForCurrency(Number.isFinite(legacy) ? legacy : 0, currencyCode(fallbackCurrency) || "USD");
}

function transactionView(record, fallbackCurrency = "USD", prefix = "") {
  const key = (name) => prefix ? `${prefix}_${name}` : name;
  const fallbackAmountKey = prefix ? `${prefix}_amount` : "amount";
  const currency = currencyCode(record?.[key("currency")], fallbackCurrency) || "USD";
  const originalAmount = record?.[key("original_amount")] ?? record?.[fallbackAmountKey] ?? 0;
  const normalizedBase = baseAmount(record, fallbackCurrency, prefix);
  return {
    originalAmount,
    currency,
    exchangeRate: record?.[key("exchange_rate")] ?? 1,
    baseAmount: normalizedBase,
    baseCurrency: record?.[key("base_currency")] || fallbackCurrency || "USD",
    converted: currency !== (record?.[key("base_currency")] || fallbackCurrency || "USD"),
  };
}

function hasFinancialActivity(db, lifeSpaceId) {
  return ["expenses", "contributions", "recurring_expenses"].some((table) =>
    db.table(table).where((row) => row.life_space_id === lifeSpaceId).length > 0
  );
}

module.exports = {
  SUPPORTED_CURRENCIES,
  USD_REFERENCE_VALUES,
  RATE_TABLE_VERSION,
  currencyCode,
  currencyError,
  exchangeRateFor,
  roundForCurrency,
  normalizeTransaction,
  monetaryFields,
  baseAmount,
  transactionView,
  hasFinancialActivity,
};
