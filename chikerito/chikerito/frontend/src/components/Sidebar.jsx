import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const links = [
  { to: "/app", label: "Mission Control", end: true },
  { to: "/app/life-spaces", label: "My Life Spaces" },
  { to: "/app/planning", label: "Event Planning" },
  { to: "/app/finance", label: "Finance Hub" },
  { to: "/app/budget-spreadsheet", label: "Budget Spreadsheet" },
  { to: "/app/expenses", label: "Expense Tracker" },
  { to: "/app/recurring-expenses", label: "Recurring Expenses" },
  { to: "/app/contributions", label: "Contributions" },
  { to: "/app/analytics", label: "Analytics" },
  { to: "/app/budget-scenarios", label: "Budget Scenarios" },
  { to: "/app/team", label: "Team" },
  { to: "/app/report", label: "Progress Report" },
  { to: "/app/audit-log", label: "Activity Log" },
  { to: "/app/settings", label: "Settings" },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <aside className="sidebar">
      <div className="brand">
        Chikerito<span className="dot">.</span>
      </div>
      <nav>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div style={{ fontSize: 13, marginBottom: 8 }}>{user ? `${user.firstName} ${user.lastName}` : ""}</div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ color: "#cfd6e6", padding: 0 }}
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          Sign out →
        </button>
      </div>
    </aside>
  );
}
