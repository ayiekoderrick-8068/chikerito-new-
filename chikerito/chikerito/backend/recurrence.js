// Date math and occurrence generation for recurring expenses. No background
// job/scheduler exists in this app (it's a single-process dev server with no
// cron), so occurrences are generated lazily: runDueOccurrences() is called
// at the top of every read that touches a life space's expenses/dashboard,
// catching up anything due as of "today" before the read happens. Calling it
// repeatedly on the same day is a no-op — see last_generated_date below.
const { v4: uuid } = require("uuid");
const db = require("./db");
const { monetaryFields, transactionView, roundForCurrency } = require("./currency");

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Adds n calendar months, clamping the day to the last valid day of the
// target month (e.g. Jan 31 + 1 month -> Feb 28/29, not an overflow into
// March) — the standard convention for recurring billing dates.
function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMonths = (m - 1) + n;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12; // 0-indexed, always positive
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay)).toISOString().slice(0, 10);
}

function addInterval(dateStr, frequency) {
  switch (frequency) {
    case "weekly":
      return addDays(dateStr, 7);
    case "biweekly":
      return addDays(dateStr, 14);
    case "monthly":
      return addMonths(dateStr, 1);
    case "quarterly":
      return addMonths(dateStr, 3);
    case "yearly":
      return addMonths(dateStr, 12);
    default:
      throw new Error(`Unknown frequency: ${frequency}`);
  }
}

// The next occurrence date for a rule, or null if it has none left (stopped,
// paused, or past its end date). Purely a function of stored fields — same
// logic runDueOccurrences() uses to decide what's due, exposed separately so
// list/detail responses can show it without materializing anything.
function nextOccurrence(recurring, today = todayStr()) {
  if (recurring.status !== "active") return null;
  const next = recurring.last_generated_date ? addInterval(recurring.last_generated_date, recurring.frequency) : recurring.start_date;
  if (recurring.end_date && next > recurring.end_date) return null;
  return next;
}

// Every occurrence date from (last_generated_date, exclusive) or start_date
// (inclusive) up through min(today, end_date). Empty if nothing is due yet.
function dueDates(recurring, today = todayStr()) {
  const dates = [];
  let cursor = recurring.last_generated_date ? addInterval(recurring.last_generated_date, recurring.frequency) : recurring.start_date;
  const limit = recurring.end_date && recurring.end_date < today ? recurring.end_date : today;
  while (cursor <= limit) {
    dates.push(cursor);
    cursor = addInterval(cursor, recurring.frequency);
  }
  return dates;
}

function activeException(recurringId, occurrenceDate) {
  return db.table("recurring_expense_exceptions").where(
    (exception) => exception.recurring_expense_id === recurringId
      && exception.occurrence_date === occurrenceDate
      && exception.status === "active"
  )[0] || null;
}

function scheduledDates(recurring, through, { from = recurring.start_date, limit = 5000 } = {}) {
  const dates = [];
  let cursor = recurring.start_date;
  let seen = 0;
  while (cursor < from && seen < limit) {
    cursor = addInterval(cursor, recurring.frequency);
    seen += 1;
  }
  while (cursor <= through && seen < limit) {
    if (recurring.end_date && cursor > recurring.end_date) break;
    dates.push(cursor);
    cursor = addInterval(cursor, recurring.frequency);
    seen += 1;
  }
  return dates;
}

function materializedOccurrence(recurringId, occurrenceDate) {
  return db.table("expenses").where((expense) =>
    expense.recurring_expense_id === recurringId
    && (expense.recurring_occurrence_date === occurrenceDate
      || (!expense.recurring_occurrence_date && expense.payment_date === occurrenceDate))
  )[0] || null;
}

function effectiveOccurrence(recurring, occurrenceDate) {
  const exception = activeException(recurring.id, occurrenceDate);
  if (exception?.action === "skip") {
    return { occurrenceDate, state: "skipped", skipped: true, exception, effectiveDate: null };
  }
  return {
    occurrenceDate,
    state: exception ? "overridden" : "scheduled",
    skipped: false,
    exception,
    effectiveDate: exception?.override_date || occurrenceDate,
    vendor: exception?.override_vendor || recurring.vendor,
    amount: exception?.override_amount ?? recurring.amount,
    categoryId: exception?.override_category_id ?? recurring.category_id ?? null,
  };
}

function previewOccurrences(recurring, { from = todayStr(), to, limit = 50 } = {}) {
  const horizon = to || addDays(from, 180);
  return scheduledDates(recurring, horizon, { from })
    .slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)))
    .map((occurrenceDate) => {
      const effective = effectiveOccurrence(recurring, occurrenceDate);
      const materialized = materializedOccurrence(recurring.id, occurrenceDate);
      return {
        ...effective,
        materialized: !!materialized,
        expenseId: materialized?.id || null,
      };
    });
}

function nextOccurrenceWithExceptions(recurring, today = todayStr()) {
  if (recurring.status !== "active") return null;
  let horizon = recurring.start_date > today ? recurring.start_date : today;
  for (let year = 0; year < 20; year += 1) horizon = addInterval(horizon, "yearly");
  const candidates = scheduledDates(recurring, horizon, { limit: 5000 })
    .map((date) => effectiveOccurrence(recurring, date))
    .filter((occurrence) => !occurrence.skipped && !materializedOccurrence(recurring.id, occurrence.occurrenceDate))
    .filter((occurrence) => occurrence.effectiveDate >= today)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.occurrenceDate.localeCompare(b.occurrenceDate));
  return candidates[0]?.effectiveDate || null;
}

// Materializes every due occurrence for every active recurring expense in a
// life space as a normal expenses row, then advances last_generated_date so
// the same period is never generated twice.
function runDueOccurrences(lifeSpaceId) {
  const today = todayStr();
  const active = db.table("recurring_expenses").where((r) => r.life_space_id === lifeSpaceId && r.status === "active");
  active.forEach((recurring) => {
    const ordinarilyDue = scheduledDates(recurring, today);
    const movedEarlier = db.table("recurring_expense_exceptions").where((exception) =>
      exception.recurring_expense_id === recurring.id
      && exception.status === "active"
      && exception.action === "override"
      && exception.override_date
      && exception.override_date <= today
      && exception.occurrence_date > today
    ).map((exception) => exception.occurrence_date);
    const due = [...new Set([...ordinarilyDue, ...movedEarlier])].sort();
    due.forEach((occurrenceDate) => {
      if (materializedOccurrence(recurring.id, occurrenceDate)) return;
      const effective = effectiveOccurrence(recurring, occurrenceDate);
      if (effective.skipped || effective.effectiveDate > today) return;
      const lifeSpace = db.table("life_spaces").find(lifeSpaceId);
      const snapshot = transactionView(recurring, lifeSpace?.currency || "USD");
      const money = {
        ...snapshot,
        originalAmount: effective.amount,
        baseAmount: roundForCurrency(effective.amount * snapshot.exchangeRate, snapshot.baseCurrency),
      };
      db.table("expenses").insert({
        id: uuid(),
        life_space_id: lifeSpaceId,
        category_id: effective.categoryId,
        vendor: effective.vendor,
        planned_amount: effective.amount,
        amount: effective.amount,
        ...monetaryFields(money),
        ...monetaryFields(money, "planned"),
        invoice_url: null,
        receipt_url: null,
        payment_date: effective.effectiveDate,
        status: "paid",
        notes: effective.exception
          ? `Auto-generated from a recurring expense (${recurring.frequency}) with an occurrence override.`
          : `Auto-generated from a recurring expense (${recurring.frequency}).`,
        recurring_expense_id: recurring.id,
        recurring_occurrence_date: occurrenceDate,
        created_at: new Date().toISOString(),
      });
    });
    if (ordinarilyDue.length) {
      db.table("recurring_expenses").update(recurring.id, { last_generated_date: ordinarilyDue[ordinarilyDue.length - 1] });
    }
  });
}

module.exports = {
  FREQUENCIES,
  todayStr,
  addInterval,
  nextOccurrence,
  dueDates,
  scheduledDates,
  activeException,
  effectiveOccurrence,
  materializedOccurrence,
  previewOccurrences,
  nextOccurrenceWithExceptions,
  runDueOccurrences,
};
