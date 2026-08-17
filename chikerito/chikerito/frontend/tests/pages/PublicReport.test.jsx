import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import PublicReport from "../../src/pages/PublicReport.jsx";
import { api } from "../../src/api";

vi.mock("../../src/api");

function renderPage(slug = "ada-wedding") {
  return render(
    <MemoryRouter initialEntries={[`/report/${slug}`]}>
      <Routes>
        <Route path="/report/:slug" element={<PublicReport />} />
      </Routes>
    </MemoryRouter>
  );
}

const readyData = {
  lifeSpace: { title: "Ada & Chip's Wedding", milestoneType: "wedding", story: "", goalAmount: 10000, currency: "USD", slug: "ada-wedding", coverImage: null, allowIndexing: false },
  stats: { goal: 10000, raised: 4000, remainingGoal: 6000, progress: 40, contributorCount: 3 },
  categoryBreakdown: [],
  budgetVisible: false,
};

describe("PublicReport — visibility and passcode gating", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("shows the report once the request succeeds", async () => {
    api.getPublicReport.mockResolvedValue(readyData);
    renderPage();

    expect(await screen.findByText(/support this milestone/i)).toBeInTheDocument();
    expect(screen.getByText(/download png/i)).toBeInTheDocument();
  });

  it("shows a private message when the life space is not public", async () => {
    const err = new Error("This event is private.");
    err.data = { private: true };
    api.getPublicReport.mockRejectedValue(err);
    renderPage();

    expect(await screen.findByText(/this event is private/i)).toBeInTheDocument();
    expect(screen.queryByText(/support this milestone/i)).not.toBeInTheDocument();
  });

  it("shows the passcode gate when one is required, then unlocks the report on the right code", async () => {
    const passcodeErr = new Error("This event requires a passcode.");
    passcodeErr.data = { passcodeRequired: true };
    api.getPublicReport.mockRejectedValueOnce(passcodeErr).mockResolvedValueOnce(readyData);
    renderPage();

    expect(await screen.findByPlaceholderText(/enter passcode/i)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/enter passcode/i), "1234");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/support this milestone/i)).toBeInTheDocument();
    expect(api.getPublicReport).toHaveBeenLastCalledWith("ada-wedding", "1234");
  });

  it("shows an incorrect-passcode error and stays on the gate after a wrong attempt", async () => {
    const passcodeErr = new Error("This event requires a passcode.");
    passcodeErr.data = { passcodeRequired: true };
    api.getPublicReport.mockRejectedValue(passcodeErr);
    renderPage();
    await screen.findByPlaceholderText(/enter passcode/i);

    await userEvent.type(screen.getByPlaceholderText(/enter passcode/i), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/incorrect passcode/i)).toBeInTheDocument();
  });

  it("remembers a passcode already entered this session and doesn't re-prompt", async () => {
    sessionStorage.setItem("chikerito_passcode_ada-wedding", "1234");
    api.getPublicReport.mockResolvedValue(readyData);
    renderPage();

    await screen.findByText(/support this milestone/i);
    expect(api.getPublicReport).toHaveBeenCalledWith("ada-wedding", "1234");
  });

  it("shows a generic error for an unknown slug", async () => {
    const err = new Error("Life space not found");
    err.data = {};
    api.getPublicReport.mockRejectedValue(err);
    renderPage("does-not-exist");

    expect(await screen.findByText("Life space not found")).toBeInTheDocument();
  });
});
