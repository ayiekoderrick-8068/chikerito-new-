export function formatMoney(value, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export function changeLabel(value) {
  if (value === null) return "New in this period";
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${value}% vs previous period`;
}

export function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function analyticsCsv(data) {
  const rows = [
    ["Analytics export"], ["From", data.filters.from || "All time"], ["To", data.filters.to || "All time"], ["Currency", data.currency], [],
    ["Metric", "Value"], ["Spent", data.summary.spent], ["Raised", data.summary.raised], ["Net", data.summary.net], ["Budget", data.summary.budget],
    ["Variance", data.summary.variance], ["Expense count", data.summary.expenseCount], ["Average expense", data.summary.averageExpense], [],
    ["Category", "Budget", "Spent", "Raised", "Variance", "Utilization %"],
    ...data.categoryBreakdown.map((row) => [row.name, row.budget, row.spent, row.raised, row.variance, row.utilization ?? ""]), [],
    ["Month", "Spent"], ...data.monthlyTrend.map((row) => [row.month, row.total]), [],
    ["Vendor", "Spent", "Transactions"], ...data.topVendors.map((row) => [row.vendor, row.total, row.count]),
    [], ["Insight", "Message"], ...(data.insights || []).map((row) => [row.code, row.message]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function downloadAnalyticsCsv(data, title = "analytics") {
  const blob = new Blob([analyticsCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "analytics"}-analytics.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
