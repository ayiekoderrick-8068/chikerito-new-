// Seeds demo data matching the "Clinton & Mary" wedding fund example used in product design.
// Run with: npm run seed
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const db = require("./db");

async function seed() {
  db.save({
    users: [],
    life_spaces: [],
    team_members: [],
    budget_categories: [],
    contributions: [],
    expenses: [],
    recurring_expenses: [],
    budget_scenarios: [],
    budget_scenario_adjustments: [],
    tasks: [],
    notifications: [],
    notification_user_states: [],
  });

  const users = db.table("users");
  const passwordHash = await bcrypt.hash("chikerito123", 10);
  const owner = users.insert({
    id: uuid(),
    first_name: "Clinton",
    last_name: "Otieno",
    email: "demo@chikerito.com",
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  });

  const lifeSpace = db.table("life_spaces").insert({
    id: uuid(),
    owner_id: owner.id,
    title: "Clinton & Mary's Wedding Fund",
    milestone_type: "wedding",
    story: "Thank you for helping make our dream day possible!",
    goal_amount: 20000,
    currency: "USD",
    theme: "lavender-luxury",
    visibility: "public",
    show_budget_public: true,
    allow_indexing: true,
    passcode_hash: null,
    cover_image: null,
    slug: "clinton-mary-wedding",
    status: "active",
    created_at: new Date().toISOString(),
  });

  db.table("team_members").insert({
    id: uuid(),
    life_space_id: lifeSpace.id,
    user_id: owner.id,
    role: "owner",
    invited_at: new Date().toISOString(),
  });

  const cat = (name, icon, budget) =>
    db.table("budget_categories").insert({
      id: uuid(),
      life_space_id: lifeSpace.id,
      name,
      icon,
      budget_amount: budget,
      created_at: new Date().toISOString(),
    });

  const reception = cat("Reception", "building", 2200);
  const lodging = cat("Lodging", "bed", 1100);
  const flights = cat("Flights", "plane", 1500);
  const dj = cat("DJ", "music", 400);
  const emcee = cat("Emcee", "mic", 500);
  const limo = cat("Limo (20 ppl)", "car", 1000);
  const catering = cat("Catering", "utensils", 1000);
  const decor = cat("Decor", "flower", 300);
  const flowers = cat("Flowers", "flower-2", 500);
  const honeymoon = cat("Honeymoon", "heart", 2000);
  const move = cat("Move", "truck", 5000);
  const rings = cat("Rings", "gem", 1000);

  const contribute = (categoryId, name, amount, message) =>
    db.table("contributions").insert({
      id: uuid(),
      life_space_id: lifeSpace.id,
      category_id: categoryId,
      contributor_name: name,
      amount,
      message: message || "",
      payment_method: "card",
      status: "completed",
      created_at: new Date().toISOString(),
    });

  contribute(dj.id, "Aunt Josephine", 400, "So happy for you two!");
  contribute(rings.id, "The Otieno Family", 1000, "A small token of our love.");
  contribute(catering.id, "David", 250, "Can't wait to eat at your wedding!");
  contribute(honeymoon.id, "Anonymous", 50, "Enjoy your honeymoon!");
  contribute(null, "Sarah", 100, "Congratulations!");

  const expense = (categoryId, vendor, amount, status, receipt, plannedAmount) =>
    db.table("expenses").insert({
      id: uuid(),
      life_space_id: lifeSpace.id,
      category_id: categoryId,
      vendor,
      planned_amount: plannedAmount !== undefined ? plannedAmount : amount,
      amount,
      invoice_url: null,
      receipt_url: receipt ? "receipt-uploaded.pdf" : null,
      payment_date: new Date().toISOString().slice(0, 10),
      status,
      notes: "",
      created_at: new Date().toISOString(),
    });

  expense(dj.id, "DJ Marcus Sounds", 400, "paid", true);
  expense(rings.id, "Elegant Jewelers", 1000, "paid", true);
  // Planned-but-not-yet-paid line items, to demo the budget spreadsheet's planned vs. actual columns
  expense(catering.id, "Caterer deposit", 0, "pending", false, 500);
  expense(flowers.id, "Bloom & Co florist", 0, "pending", false, 300);
  expense(decor.id, "Decor rental", 150, "paid", true, 250);

  const daysFromNow = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const task = (title, category, dayOffset, completed) =>
    db.table("tasks").insert({
      id: uuid(),
      life_space_id: lifeSpace.id,
      title,
      category,
      due_date: daysFromNow(dayOffset),
      completed,
      notes: "",
      created_at: new Date().toISOString(),
    });

  task("Book venue", "Venue", -365, true);
  task("Hire photographer", "Photography", -300, true);
  task("Order wedding cake", "Cake", -90, true);
  task("Book DJ", "Music", -60, true);
  task("Buy wedding dress", "Dress", -5, false); // overdue example
  task("Book decor & florist", "Decor", 5, false);
  task("Send invitations", "Guests", 10, false);
  task("Arrange transportation (limo)", "Transportation", 30, false);
  task("Book accommodation for guests", "Accommodation", 40, false);
  task("Final catering payment", "Catering", 75, false);
  task("Finalize seating chart", "Guests", 85, false);
  task("Book honeymoon flights", "Honeymoon", 100, false);

  db.table("notifications").insert({
    id: uuid(),
    life_space_id: lifeSpace.id,
    type: "milestone_funded",
    message: "DJ is now fully funded!",
    read: false,
    created_at: new Date().toISOString(),
  });
  db.table("notifications").insert({
    id: uuid(),
    life_space_id: lifeSpace.id,
    type: "milestone_funded",
    message: "Rings are now fully funded!",
    read: false,
    created_at: new Date().toISOString(),
  });

  console.log("Seed complete.");
  console.log("Demo login -> email: demo@chikerito.com  password: chikerito123");
  console.log(`Life space slug: ${lifeSpace.slug}`);
}

seed();
