import { useEffect, useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";

export default function Contributions() {
  const { currentId, current } = useLifeSpace();
  const [contributions, setContributions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    api.listContributions(currentId).then(({ contributions }) => setContributions(contributions)).finally(() => setLoading(false));
  }, [currentId]);

  if (!currentId) {
    return (
      <>
        <Topbar title="Contributions" />
        <div className="page-body"><div className="empty-state card">Create a Life Space to start receiving contributions.</div></div>
      </>
    );
  }

  const filtered = contributions.filter((c) => c.contributor_name.toLowerCase().includes(search.toLowerCase()));
  const shareLink = current ? `${window.location.origin}/donate/${current.slug}` : "";

  return (
    <>
      <Topbar title="Contributions" />
      <div className="page-body">
        <div className="card" style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <strong>Public donation link:</strong>{" "}
            <code style={{ background: "#f2efe8", padding: "4px 8px", borderRadius: 6 }}>{shareLink}</code>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(shareLink);
              alert("Copied!");
            }}
          >
            Copy Link
          </button>
        </div>

        <div className="field" style={{ maxWidth: 280, marginBottom: 16 }}>
          <input placeholder="Search by contributor..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="card">
          {loading ? (
            <p>Loading...</p>
          ) : filtered.length === 0 ? (
            <div className="empty-state">No contributions yet. Share your donation link to get started.</div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Contributor</th><th>Amount</th><th>Method</th><th>Status</th><th>Message</th></tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>{c.contributor_name}</td>
                    <td>${c.amount.toLocaleString()}</td>
                    <td>{c.payment_method}</td>
                    <td><span className="badge badge-success">{c.status}</span></td>
                    <td style={{ color: "var(--text-muted)" }}>{c.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
