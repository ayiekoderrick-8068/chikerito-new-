// Date math and occurrence generation for recurring expenses. No background
// job/scheduler exists in this app (it's a single-process dev server with no
// cron), so occurrences are generated lazily: runDueOccurrences() is called
// at the top of every read that touches a life space's expenses/dashboard,
// catching up anything due as of "today" before the read happens. Calling it
// repeatedly on the same day is a no-op — see last_generated_date below.
const { v4: uuid } = require("uuid");
const db = require("./db");

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

// Materializes every due occurrence for every active recurring expense in a
// life space as a normal expenses row, then advances last_generated_date so
// the same period is never generated twice.
function runDueOccurrences(lifeSpaceId) {
  const today = todayStr();
  const active = db.table("recurring_expenses").where((r) => r.life_space_id === lifeSpaceId && r.status === "active");
  active.forEach((recurring) => {
    const due = dueDates(recurring, today);
    if (!due.length) return;
    due.forEach((date) => {
      db.table("expenses").insert({
        id: uuid(),
        life_space_id: lifeSpaceId,
        category_id: recurring.category_id || null,
        vendor: recurring.vendor,
        planned_amount: recurring.amount,
        amount: recurring.amount,
        invoice_url: null,
        receipt_url: null,
        payment_date: date,
        status: "paid",
        notes: `Auto-generated from a recurring expense (${recurring.frequency}).`,
        recurring_expense_id: recurring.id,
        created_at: new Date().toISOString(),
      });
    });
    db.table("recurring_expenses").update(recurring.id, { last_generated_date: due[due.length - 1] });
  });
}

module.exports = { FREQUENCIES, todayStr, addInterval, nextOccurrence, dueDates, runDueOccurrences };
