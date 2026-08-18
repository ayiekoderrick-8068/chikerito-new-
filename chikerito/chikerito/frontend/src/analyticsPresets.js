function iso(date) {
  return date.toISOString().slice(0, 10);
}

function utcDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  return new Date(`${value}T00:00:00Z`);
}

export function shiftDays(value, amount) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return iso(date);
}

export function startOfMonth(value) {
  const date = utcDate(value);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function startOfYear(value) {
  const date = utcDate(value);
  return `${date.getUTCFullYear()}-01-01`;
}

export function analyticsPreset(name, today = new Date()) {
  const to = iso(utcDate(today));
  switch (name) {
    case "this-month":
      return { from: startOfMonth(to), to };
    case "last-30-days":
      return { from: shiftDays(to, -29), to };
    case "year-to-date":
      return { from: startOfYear(to), to };
    case "all-time":
      return { from: "", to: "" };
    default:
      throw new Error(`Unknown analytics preset: ${name}`);
  }
}

export function rangeLabel(filters) {
  if (!filters.from && !filters.to) return "All time";
  if (filters.from && filters.to) return `${filters.from} to ${filters.to}`;
  if (filters.from) return `Since ${filters.from}`;
  return `Through ${filters.to}`;
}
