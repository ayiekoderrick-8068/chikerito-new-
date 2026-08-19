function calendarDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  return new Date(`${value}T00:00:00`);
}

export function shiftDays(value, amount) {
  const date = localDate(value);
  date.setDate(date.getDate() + amount);
  return calendarDate(date);
}

export function startOfMonth(value) {
  const date = localDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function startOfYear(value) {
  const date = localDate(value);
  return `${date.getFullYear()}-01-01`;
}

export function analyticsPreset(name, today = new Date()) {
  const to = calendarDate(localDate(today));
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
