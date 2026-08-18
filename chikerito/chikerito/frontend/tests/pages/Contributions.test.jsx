import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Contributions from "../../src/pages/Contributions.jsx";
import { api } from "../../src/api";
import { useLifeSpace } from "../../src/context/LifeSpaceContext.jsx";

vi.mock("../../src/api");
vi.mock("../../src/context/LifeSpaceContext.jsx", () => ({ useLifeSpace: vi.fn() }));

function renderPage() {
  return render(
    <MemoryRouter>
      <Contributions />
    </MemoryRouter>
  );
}

const contributions = [
  { id: "c1", contributor_name: "Aunt Mary", amount: 100, payment_method: "card", status: "completed", message: "Congrats!", created_at: "2026-03-01T00:00:00.000Z" },
  { id: "c2", contributor_name: "Uncle Bob", amount: 250, payment_method: "card", status: "completed", message: "", created_at: "2026-03-02T00:00:00.000Z" },
];

describe("Contributions", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });
    window.alert = vi.fn();
    // Mock all API methods
    api.listContributions = vi.fn();
    api.createContribution = vi.fn();
    api.updateContribution = vi.fn();
    api.listCategories = vi.fn().mockResolvedValue({ categories: [] });
  });

  it("prompts to create a life space when there is none yet", () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: null, current: null });
    renderPage();
    expect(screen.getByText(/create a life space to start receiving contributions/i)).toBeInTheDocument();
  });

  it("lists contributions once loaded", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", slug: "ada-wedding" } });
    api.listContributions.mockResolvedValue({ contributions });
    renderPage();

    expect(await screen.findByText("Aunt Mary")).toBeInTheDocument();
    expect(screen.getByText("Uncle Bob")).toBeInTheDocument();
    expect(screen.getByText("$100")).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });

  it("shows an empty state when there are no contributions", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", slug: "ada-wedding" } });
    api.listContributions.mockResolvedValue({ contributions: [] });
    renderPage();
    expect(await screen.findByText(/no contributions yet/i)).toBeInTheDocument();
  });

  it("filters the list by contributor name, case-insensitively", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", slug: "ada-wedding" } });
    api.listContributions.mockResolvedValue({ contributions });
    renderPage();
    await screen.findByText("Aunt Mary");

    await userEvent.type(screen.getByPlaceholderText(/search by contributor/i), "bob");

    expect(screen.queryByText("Aunt Mary")).not.toBeInTheDocument();
    expect(screen.getByText("Uncle Bob")).toBeInTheDocument();
  });

  it("builds the public donation link from the current life space's slug", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", slug: "ada-wedding" } });
    api.listContributions.mockResolvedValue({ contributions: [] });
    renderPage();
    expect(await screen.findByText(`${window.location.origin}/donate/ada-wedding`)).toBeInTheDocument();
  });

  it("copies the share link to the clipboard", async () => {
    useLifeSpace.mockReturnValue({ lifeSpaces: [], selectLifeSpace: vi.fn(), currentId: "ls1", current: { id: "ls1", slug: "ada-wedding" } });
    api.listContributions.mockResolvedValue({ contributions: [] });
    renderPage();
    await screen.findByText(/copy link/i);

    await userEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/donate/ada-wedding`)
    );
  });
});
