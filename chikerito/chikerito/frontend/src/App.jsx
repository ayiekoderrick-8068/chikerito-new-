import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import ResetPassword from "./pages/ResetPassword.jsx";
import DonatePage from "./pages/DonatePage.jsx";
import PublicReport from "./pages/PublicReport.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { LifeSpaceProvider } from "./context/LifeSpaceContext.jsx";

import Dashboard from "./pages/Dashboard.jsx";
import LifeSpaces from "./pages/LifeSpaces.jsx";
import Planning from "./pages/Planning.jsx";
import FinanceHub from "./pages/FinanceHub.jsx";
import BudgetSpreadsheet from "./pages/BudgetSpreadsheet.jsx";
import ExpenseTracker from "./pages/ExpenseTracker.jsx";
import RecurringExpenses from "./pages/RecurringExpenses.jsx";
import Contributions from "./pages/Contributions.jsx";
import Analytics from "./pages/Analytics.jsx";
import BudgetScenarios from "./pages/BudgetScenarios.jsx";
import Team from "./pages/Team.jsx";
import Settings from "./pages/Settings.jsx";
import Report from "./pages/Report.jsx";
import AuditLog from "./pages/AuditLog.jsx";

function AppShell() {
  return (
    <LifeSpaceProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="main-area">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="life-spaces" element={<LifeSpaces />} />
            <Route path="planning" element={<Planning />} />
            <Route path="finance" element={<FinanceHub />} />
            <Route path="budget-spreadsheet" element={<BudgetSpreadsheet />} />
            <Route path="expenses" element={<ExpenseTracker />} />
            <Route path="recurring-expenses" element={<RecurringExpenses />} />
            <Route path="contributions" element={<Contributions />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="budget-scenarios" element={<BudgetScenarios />} />
            <Route path="team" element={<Team />} />
            <Route path="report" element={<Report />} />
            <Route path="audit-log" element={<AuditLog />} />
            <Route path="settings" element={<Settings />} />
          </Routes>
        </div>
      </div>
    </LifeSpaceProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/donate/:slug" element={<DonatePage />} />
      <Route path="/report/:slug" element={<PublicReport />} />
      <Route
        path="/app/*"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
