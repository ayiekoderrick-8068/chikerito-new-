import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api.js";

function response(body = { analytics: {} }, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

describe("api.getAnalytics", () => {
  beforeEach(() => { localStorage.setItem("chikerito_token", "token-123"); global.fetch = vi.fn(() => response()); });

  it("requests all-time analytics without a query string", async () => {
    await api.getAnalytics("space-1");
    expect(fetch).toHaveBeenCalledWith("/api/lifespaces/space-1/analytics", expect.objectContaining({ method: "GET" }));
  });

  it("sends the bearer token", async () => {
    await api.getAnalytics("space-1");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer token-123");
  });

  it("serializes a from date", async () => {
    await api.getAnalytics("space-1", { from: "2026-01-01" });
    expect(fetch.mock.calls[0][0]).toContain("from=2026-01-01");
  });

  it("serializes a to date", async () => {
    await api.getAnalytics("space-1", { to: "2026-01-31" });
    expect(fetch.mock.calls[0][0]).toContain("to=2026-01-31");
  });

  it("serializes a category id", async () => {
    await api.getAnalytics("space-1", { categoryId: "category/a" });
    expect(fetch.mock.calls[0][0]).toContain("categoryId=category%2Fa");
  });

  it("serializes previous comparison", async () => {
    await api.getAnalytics("space-1", { comparison: "previous" });
    expect(fetch.mock.calls[0][0]).toContain("comparison=previous");
  });

  it("omits the default comparison", async () => {
    await api.getAnalytics("space-1", { comparison: "none" });
    expect(fetch.mock.calls[0][0]).not.toContain("comparison");
  });

  it("combines filters in stable insertion order", async () => {
    await api.getAnalytics("space-1", { from: "2026-01-01", to: "2026-01-31", categoryId: "cat", comparison: "previous" });
    expect(fetch.mock.calls[0][0]).toBe("/api/lifespaces/space-1/analytics?from=2026-01-01&to=2026-01-31&categoryId=cat&comparison=previous");
  });

  it("returns the parsed analytics response", async () => {
    global.fetch = vi.fn(() => response({ analytics: { summary: { spent: 10 } } }));
    await expect(api.getAnalytics("space-1")).resolves.toEqual({ analytics: { summary: { spent: 10 } } });
  });

  it("surfaces the backend validation message", async () => {
    global.fetch = vi.fn(() => response({ error: "from must be valid" }, 400));
    await expect(api.getAnalytics("space-1", { from: "bad" })).rejects.toThrow("from must be valid");
  });

  it("attaches the response status to errors", async () => {
    global.fetch = vi.fn(() => response({ error: "Forbidden" }, 403));
    await expect(api.getAnalytics("space-1")).rejects.toMatchObject({ status: 403 });
  });

  it("clears authentication on a 401", async () => {
    global.fetch = vi.fn(() => response({ error: "Expired" }, 401)); const dispatch = vi.spyOn(window, "dispatchEvent");
    await expect(api.getAnalytics("space-1")).rejects.toThrow("Expired");
    expect(localStorage.getItem("chikerito_token")).toBeNull(); expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "chikerito:unauthorized" }));
  });

  it("uses a generic message for a non-JSON error", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.reject(new Error("bad json")) }));
    await expect(api.getAnalytics("space-1")).rejects.toThrow("Request failed (503)");
  });
});
