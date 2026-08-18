import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ScenarioForecast,
  allocationMap,
  money,
  payloadFromDraft,
} from "../src/pages/BudgetScenarios.jsx";

describe("budget scenario editor mapping", () => {
  const categories = [
    { id: "a", name: "Alpha", budget_amount: 100 },
    { id: "b", name: "Beta", budget_amount: 200 },
  ];

  it("creates one editable assumption row per live category", () => {
    expect(allocationMap(categories)).toEqual([
      { categoryId: "a", categoryName: "Alpha", currentBudget: 100, budgetAmount: "", projectedExpenses: "", projectedContributions: "", note: "" },
      { categoryId: "b", categoryName: "Beta", currentBudget: 200, budgetAmount: "", projectedExpenses: "", projectedContributions: "", note: "" },
    ]);
  });

  it("merges a saved allocation into its matching live category", () => {
    const mapped = allocationMap(categories, [{
      categoryId: "b", budgetAmount: 250, projectedExpenses: 20,
      projectedContributions: 40, note: "Changed",
    }]);
    expect(mapped[0].budgetAmount).toBe("");
    expect(mapped[1]).toMatchObject({ budgetAmount: 250, projectedExpenses: 20, projectedContributions: 40, note: "Changed" });
  });

  it("omits untouched allocation rows from an API payload", () => {
    const allocations = allocationMap(categories);
    const payload = payloadFromDraft({ name: "  Plan  ", description: "  Safe  ", horizonDate: "2027-01-01", allocations });
    expect(payload).toEqual({ name: "Plan", description: "Safe", horizonDate: "2027-01-01", allocations: [] });
  });

  it("keeps a zero scenario budget as an intentional override", () => {
    const allocations = allocationMap(categories);
    allocations[0].budgetAmount = "0";
    const payload = payloadFromDraft({ name: "Plan", description: "", horizonDate: "2027-01-01", allocations });
    expect(payload.allocations[0]).toMatchObject({ categoryId: "a", budgetAmount: 0 });
  });

  it("converts numeric input strings while trimming notes", () => {
    const allocations = allocationMap(categories);
    Object.assign(allocations[1], {
      budgetAmount: "275.50",
      projectedExpenses: "12.25",
      projectedContributions: "50",
      note: "  Possible sponsor  ",
    });
    const payload = payloadFromDraft({ name: "Plan", description: "", horizonDate: "2027-01-01", allocations });
    expect(payload.allocations).toEqual([{
      categoryId: "b", budgetAmount: 275.5, projectedExpenses: 12.25,
      projectedContributions: 50, note: "Possible sponsor",
    }]);
  });
});

describe("scenario money presentation", () => {
  it("formats USD values with cents", () => {
    expect(money(1234.5, "USD")).toMatch(/\$1,234\.50/);
  });

  it("uses the life-space currency", () => {
    expect(money(1000, "KES")).toMatch(/KES|Ksh/);
  });

  it("treats an absent amount as zero", () => {
    expect(money(undefined, "USD")).toMatch(/\$0\.00/);
  });
});

describe("ScenarioForecast empty and safe states", () => {
  const minimal = {
    asOf: "2026-08-18",
    horizonDate: "2026-09-18",
    currency: "USD",
    totals: {
      scenarioBudget: 0, budgetChange: 0, forecastSpent: 0,
      projectedRecurring: 0, forecastRaised: 0, projectedContributions: 0,
      fundingGap: 0,
    },
    comparison: {
      budget: { current: 0, scenario: 0, difference: 0 },
      spent: { current: 0, scenario: 0, difference: 0 },
      raised: { current: 0, scenario: 0, difference: 0 },
    },
    categoryForecasts: [],
    recurringOccurrences: [],
    warnings: [],
  };

  it("renders nothing when no forecast exists", () => {
    const { container } = render(<ScenarioForecast forecast={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels the forecast region accessibly", () => {
    render(<ScenarioForecast forecast={minimal} />);
    expect(screen.getByRole("region", { name: "Scenario forecast" })).toBeInTheDocument();
  });

  it("does not show a warning alert when there are no projected overruns", () => {
    render(<ScenarioForecast forecast={minimal} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows explicit category and recurring empty states", () => {
    render(<ScenarioForecast forecast={minimal} />);
    expect(screen.getByText("No budget categories are available.")).toBeInTheDocument();
    expect(screen.getByText(/no active recurring expenses fall within this horizon/i)).toBeInTheDocument();
  });
});
