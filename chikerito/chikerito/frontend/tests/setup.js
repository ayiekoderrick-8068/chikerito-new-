import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom doesn't implement these — stub them so components that call them
// (Planning/ExpenseTracker delete confirmations, recharts' ResponsiveContainer)
// don't crash with "not implemented".
window.confirm = () => true;
window.alert = () => {};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
