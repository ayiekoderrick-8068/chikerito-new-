const express = require("express");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
  requireMember,
  requireCapability,
  requireResourceCapability,
  requireResourceMember,
} = require("../middleware/authorize");
const { buildForecast, validateScenarioInput } = require("../budgetForecast");

const router = express.Router();

function allocationsFor(scenarioId) {
  return db.table("budget_scenario_adjustments")
    .where((adjustment) => adjustment.scenario_id === scenarioId)
    .map((adjustment) => ({
      id: adjustment.id,
      categoryId: adjustment.category_id,
      budgetAmount: adjustment.budget_amount,
      projectedExpenses: adjustment.projected_expenses,
      projectedContributions: adjustment.projected_contributions,
      note: adjustment.note || "",
    }))
    .sort((a, b) => String(a.categoryId).localeCompare(String(b.categoryId)));
}

function scenarioDraft(scenario) {
  return {
    name: scenario.name,
    description: scenario.description || "",
    horizonDate: scenario.horizon_date,
    allocations: allocationsFor(scenario.id),
  };
}

function serializeScenario(scenario, { includeForecast = true } = {}) {
  const draft = scenarioDraft(scenario);
  const serialized = {
    id: scenario.id,
    lifeSpaceId: scenario.life_space_id,
    name: scenario.name,
    description: scenario.description || "",
    horizonDate: scenario.horizon_date,
    createdBy: scenario.created_by,
    createdAt: scenario.created_at,
    updatedAt: scenario.updated_at,
    allocations: draft.allocations,
  };
  if (includeForecast) serialized.forecast = buildForecast(scenario.life_space_id, draft);
  return serialized;
}

function allocationRows(scenario, allocations, now) {
  return allocations.map((allocation) => ({
    id: uuid(),
    scenario_id: scenario.id,
    life_space_id: scenario.life_space_id,
    category_id: allocation.categoryId,
    budget_amount: allocation.budgetAmount === undefined || allocation.budgetAmount === null || allocation.budgetAmount === ""
      ? null
      : Number(allocation.budgetAmount),
    projected_expenses: Number(allocation.projectedExpenses || 0),
    projected_contributions: Number(allocation.projectedContributions || 0),
    note: String(allocation.note || "").trim(),
    created_at: now,
  }));
}

function replaceAllocations(scenario, allocations, now) {
  const table = db.table("budget_scenario_adjustments");
  const otherRows = table.all().filter((adjustment) => adjustment.scenario_id !== scenario.id);
  table.replaceAll([...otherRows, ...allocationRows(scenario, allocations, now)]);
}

function validationResponse(res, errors) {
  if (!errors.length) return false;
  res.status(400).json({ error: errors[0], errors });
  return true;
}

router.get(
  "/lifespaces/:lifeSpaceId/budget-scenarios",
  requireAuth,
  requireMember("lifeSpaceId"),
  (req, res) => {
    const scenarios = db.table("budget_scenarios")
      .where((scenario) => scenario.life_space_id === req.params.lifeSpaceId)
      .sort((a, b) =>
        String(b.updated_at).localeCompare(String(a.updated_at))
        || String(a.name).localeCompare(String(b.name))
        || String(a.id).localeCompare(String(b.id))
      )
      .map((scenario) => {
        const serialized = serializeScenario(scenario);
        return {
          ...serialized,
          summary: {
            forecastSpent: serialized.forecast.totals.forecastSpent,
            forecastRaised: serialized.forecast.totals.forecastRaised,
            scenarioBudget: serialized.forecast.totals.scenarioBudget,
            fundingGap: serialized.forecast.totals.fundingGap,
            warningCount: serialized.forecast.warnings.length,
          },
        };
      });
    res.json({ scenarios });
  }
);

router.post(
  "/lifespaces/:lifeSpaceId/budget-scenarios/preview",
  requireAuth,
  requireMember("lifeSpaceId"),
  (req, res) => {
    const errors = validateScenarioInput(req.params.lifeSpaceId, req.body);
    if (validationResponse(res, errors)) return;
    const before = {
      expenses: db.table("expenses").count(),
      contributions: db.table("contributions").count(),
      categories: db.table("budget_categories").count(),
      scenarios: db.table("budget_scenarios").count(),
      adjustments: db.table("budget_scenario_adjustments").count(),
    };
    const forecast = buildForecast(req.params.lifeSpaceId, req.body);
    // Expose a verifiable read-only contract. This guard also catches a future
    // accidental call to recurring materialization during preview.
    const after = {
      expenses: db.table("expenses").count(),
      contributions: db.table("contributions").count(),
      categories: db.table("budget_categories").count(),
      scenarios: db.table("budget_scenarios").count(),
      adjustments: db.table("budget_scenario_adjustments").count(),
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      return res.status(500).json({ error: "Scenario preview must not mutate financial records" });
    }
    res.json({ forecast, readOnly: true });
  }
);

router.post(
  "/lifespaces/:lifeSpaceId/budget-scenarios",
  requireAuth,
  requireCapability("scenario:manage", "lifeSpaceId"),
  (req, res) => {
    const errors = validateScenarioInput(req.params.lifeSpaceId, req.body);
    if (validationResponse(res, errors)) return;
    const now = new Date().toISOString();
    const scenario = db.table("budget_scenarios").insert({
      id: uuid(),
      life_space_id: req.params.lifeSpaceId,
      name: String(req.body.name).trim(),
      description: String(req.body.description || "").trim(),
      horizon_date: req.body.horizonDate,
      created_by: req.user.id,
      created_at: now,
      updated_at: now,
    });
    replaceAllocations(scenario, req.body.allocations || [], now);
    res.status(201).json({ scenario: serializeScenario(scenario) });
  }
);

router.get(
  "/budget-scenarios/:id",
  requireAuth,
  requireResourceMember("budget_scenarios"),
  (req, res) => res.json({ scenario: serializeScenario(req.resource) })
);

router.patch(
  "/budget-scenarios/:id",
  requireAuth,
  requireResourceCapability("budget_scenarios", "scenario:manage"),
  (req, res) => {
    const existing = scenarioDraft(req.resource);
    const merged = {
      name: req.body.name === undefined ? existing.name : req.body.name,
      description: req.body.description === undefined ? existing.description : req.body.description,
      horizonDate: req.body.horizonDate === undefined ? existing.horizonDate : req.body.horizonDate,
      allocations: req.body.allocations === undefined ? existing.allocations : req.body.allocations,
    };
    const errors = validateScenarioInput(req.resource.life_space_id, merged);
    if (validationResponse(res, errors)) return;
    const now = new Date().toISOString();
    const updated = db.table("budget_scenarios").update(req.resource.id, {
      name: String(merged.name).trim(),
      description: String(merged.description || "").trim(),
      horizon_date: merged.horizonDate,
      updated_at: now,
    });
    if (req.body.allocations !== undefined) replaceAllocations(updated, merged.allocations, now);
    res.json({ scenario: serializeScenario(updated) });
  }
);

router.delete(
  "/budget-scenarios/:id",
  requireAuth,
  requireResourceCapability("budget_scenarios", "scenario:manage"),
  (req, res) => {
    const adjustments = db.table("budget_scenario_adjustments");
    adjustments.replaceAll(adjustments.all().filter((adjustment) => adjustment.scenario_id !== req.resource.id));
    db.table("budget_scenarios").remove(req.resource.id);
    res.status(204).end();
  }
);

module.exports = router;
