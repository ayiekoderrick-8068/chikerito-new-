import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "../../src/pages/Dashboard.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
}

const baseDashboardData = {
  stats: { goal: 10000, raised: 4000, spent: 1500, available: 2500, remainingGoal: 6000, progress: 40 },
  categoryBreakdown: [{ id: "c1", name: "Venue", spent: 1500 }],
  monthlyTrend: [],
  financialHealth: { score: 92, rating: "Excellent", flags: [] },
  notifications: [],
  recentContributions: [],
};

describe("Dashboard", () => {
  beforeEach(() => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null, current: null, loading: false });
  });

  it("prompts to create a life space when there is none yet", () => {
    renderDashboard();
    expect(screen.getByText(/create your first life space/i)).toBeInTheDocument();
  });

  it("renders nothing while the life space list is still loading", () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null, current: null, loading: true });
    const { container } = renderDashboard();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders headline stats once the dashboard loads", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1" }, loading: false });
    api.getDashboard.mockResolvedValue(baseDashboardData);
    renderDashboard();

    expect(await screen.findByText("$10,000")).toBeInTheDocument(); // goal
    expect(screen.getByText("$4,000")).toBeInTheDocument(); // raised
    expect(screen.getByText("$1,500")).toBeInTheDocument(); // spent
    expect(screen.getByText("$2,500")).toBeInTheDocument(); // available
    expect(screen.getByText("$6,000")).toBeInTheDocument(); // remaining goal
    expect(screen.getByText("40% of goal")).toBeInTheDocument();
  });

  it("renders the financial health score, rating, and a healthy message when there are no flags", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1" }, loading: false });
    api.getDashboard.mockResolvedValue(baseDashboardData);
    renderDashboard();

    expect(await screen.findByText("92/100")).toBeInTheDocument();
    expect(screen.getByText("Excellent")).toBeInTheDocument();
    expect(screen.getByText(/everything looks healthy/i)).toBeInTheDocument();
  });

  it("lists financial health flags when present", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1" }, loading: false });
    api.getDashboard.mockResolvedValue({
      ...baseDashboardData,
      financialHealth: { score: 55, rating: "Needs Attention", flags: ["Venue is over budget", "2 expense(s) missing receipts"] },
    });
    renderDashboard();

    expect(await screen.findByText(/venue is over budget/i)).toBeInTheDocument();
    expect(screen.getByText(/2 expense\(s\) missing receipts/i)).toBeInTheDocument();
  });

  it("shows an error banner when the dashboard request fails", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1" }, loading: false });
    api.getDashboard.mockRejectedValue(new Error("Life space not found"));
    renderDashboard();

    expect(await screen.findByText("Life space not found")).toBeInTheDocument();
  });

  it("falls back to an empty-state message when nothing has been spent yet", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1" }, loading: false });
    api.getDashboard.mockResolvedValue({
      ...baseDashboardData,
      categoryBreakdown: [{ id: "c1", name: "Venue", spent: 0 }],
    });
    renderDashboard();

    expect(await screen.findByText(/no expenses recorded yet/i)).toBeInTheDocument();
  });

  it("re-fetches when the selected life space changes", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1" }, loading: false });
    api.getDashboard.mockResolvedValue(baseDashboardData);
    const { rerender } = renderDashboard();
    await screen.findByText("40% of goal");

    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls2", current: { id: "ls2" }, loading: false });
    api.getDashboard.mockResolvedValue({ ...baseDashboardData, stats: { ...baseDashboardData.stats, progress: 75 } });
    rerender(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.getDashboard).toHaveBeenCalledWith("ls2"));
  });
});
