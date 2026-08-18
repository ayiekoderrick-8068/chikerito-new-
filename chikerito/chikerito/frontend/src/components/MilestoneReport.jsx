import { forwardRef } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { getReportTheme } from "../reportThemes.js";
import { formatMoney } from "../currency.js";

const MilestoneReport = forwardRef(function MilestoneReport({ lifeSpace, stats, categoryBreakdown, budgetVisible = true }, ref) {
  const theme = getReportTheme(lifeSpace.milestoneType || lifeSpace.milestone_type);
  const goal = stats.goal || 0;
  const raised = stats.raised || 0;
  const remaining = stats.remainingGoal ?? Math.max(goal - raised, 0);
  const progress = stats.progress || 0;
  const currency = stats.currency || lifeSpace.currency || "USD";
  const money = (value) => formatMoney(value, currency);

  const pieData = [
    { name: "Raised", value: raised || 0.0001 },
    { name: "Remaining", value: remaining },
  ];
  const coverImage = lifeSpace.coverImage || lifeSpace.cover_image;

  return (
    <div ref={ref} className="report-sheet" style={{ background: theme.bg, "--report-accent": theme.accent, "--report-accent-soft": theme.accentSoft }}>
      {coverImage ? (
        <div className="report-cover" style={{ backgroundImage: `url(${coverImage})` }}>
          <div className="report-cover-scrim">
            <h1 className="report-title report-title-on-photo">{lifeSpace.title} {theme.label}</h1>
            <p className="report-subtitle report-subtitle-on-photo">Thank you for helping make our milestone possible!</p>
          </div>
        </div>
      ) : (
        <div className="report-header">
          <span className="report-corner">{theme.corner}</span>
          <div>
            <h1 className="report-title">{lifeSpace.title} {theme.label}</h1>
            <p className="report-subtitle">Thank you for helping make our milestone possible!</p>
          </div>
          <span className="report-corner">{theme.corner}</span>
        </div>
      )}

      <div className="report-stat-row">
        <div className="report-stat">
          <div className="report-stat-icon">🎯</div>
          <div className="report-stat-label">Goal</div>
          <div className="report-stat-value">{money(goal)}</div>
        </div>
        <div className="report-stat">
          <div className="report-stat-icon">💛</div>
          <div className="report-stat-label">Raised</div>
          <div className="report-stat-value">{money(raised)}</div>
        </div>
        <div className="report-stat">
          <div className="report-stat-icon">🐷</div>
          <div className="report-stat-label">Remaining</div>
          <div className="report-stat-value">{money(remaining)}</div>
        </div>
        <div className="report-stat">
          <div className="report-stat-icon">%</div>
          <div className="report-stat-label">Progress</div>
          <div className="report-stat-value">{progress}%</div>
        </div>
      </div>

      <div className="report-two-col">
        <div className="report-panel">
          <h3 className="report-panel-title">Overall Progress</h3>
          <div className="report-progress-track">
            <div className="report-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="report-progress-labels">
            <span>{money(0)}</span>
            <span>{money(goal)}</span>
          </div>
          <p className="report-progress-line">You've raised <strong>{progress}%</strong> of our goal!</p>

          <div className="report-donut-row">
            <div style={{ width: 160, height: 160, position: "relative" }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" innerRadius={52} outerRadius={78} startAngle={90} endAngle={-270} stroke="none">
                    <Cell fill={theme.accent} />
                    <Cell fill="#e5e0f0" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="report-donut-center">
                <strong>{progress}%</strong>
                <span>of goal</span>
              </div>
            </div>
            <div className="report-legend">
              <div><span className="report-dot" style={{ background: theme.accent }} /> Raised: {money(raised)} ({progress}%)</div>
              <div><span className="report-dot" style={{ background: "#e5e0f0" }} /> Remaining: {money(remaining)} ({Math.max(100 - progress, 0)}%)</div>
            </div>
          </div>

          <div className="report-quote">💛 Every contribution brings us one step closer to our goal!</div>
        </div>

        <div className="report-panel">
          <h3 className="report-panel-title" style={{ textAlign: "center" }}>Budget Breakdown</h3>
          {!budgetVisible ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center" }}>🔒 The organizer has kept the budget breakdown private.</p>
          ) : categoryBreakdown.length === 0 ? (
            <p style={{ color: "var(--text-muted)", textAlign: "center" }}>No budget categories yet.</p>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Budget</th>
                  <th>Gift from Friends</th>
                  <th>Funded</th>
                  <th>Remaining</th>
                  <th>Progress</th>
                </tr>
              </thead>
              <tbody>
                {categoryBreakdown.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.budget > 0 ? money(c.budget) : "—"}</td>
                    <td>{c.raised > 0 ? money(c.raised) : "—"}</td>
                    <td>{money(c.spent)}</td>
                    <td>{money(c.budget > 0 ? c.remaining : 0)}</td>
                    <td>
                      <div className="report-mini-track"><div className="report-mini-fill" style={{ width: `${c.progress}%` }} /></div>
                      <span className="report-mini-pct">{c.progress}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="report-footer-bar">
        <div className="report-footer-quote">Together, we're building the next chapter of our journey.</div>
        <div className="report-footer-stats">
          <div><span className="report-corner" style={{ fontSize: 22 }}>💰</span> Total Raised<br /><strong>{money(raised)}</strong></div>
          <div><span className="report-corner" style={{ fontSize: 22 }}>{theme.footerIcon}</span> {progress}%<br />of our goal reached!</div>
        </div>
      </div>
    </div>
  );
});

export default MilestoneReport;
