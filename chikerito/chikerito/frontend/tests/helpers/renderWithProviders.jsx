import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../src/context/AuthContext.jsx";
import { LifeSpaceProvider } from "../../src/context/LifeSpaceContext.jsx";

// Wraps a component with whichever real providers it needs, exactly as App.jsx
// composes them, so page/context tests exercise the real wiring rather than a
// stand-in. Callers mock ../../src/api.js to control what each provider's
// network calls resolve to.
export function renderWithProviders(
  ui,
  { route = "/", withAuth = true, withLifeSpace = false } = {}
) {
  function Wrapper({ children }) {
    let tree = children;
    if (withLifeSpace) tree = <LifeSpaceProvider>{tree}</LifeSpaceProvider>;
    if (withAuth) tree = <AuthProvider>{tree}</AuthProvider>;
    return <MemoryRouter initialEntries={[route]}>{tree}</MemoryRouter>;
  }
  return render(ui, { wrapper: Wrapper });
}
