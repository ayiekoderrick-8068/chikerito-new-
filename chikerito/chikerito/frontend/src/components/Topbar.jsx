import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { Link } from "react-router-dom";

export default function Topbar({ title }) {
  const { lifeSpaces, currentId, selectLifeSpace } = useLifeSpace();
  return (
    <div className="topbar">
      <h1>{title}</h1>
      {lifeSpaces.length > 0 ? (
        <select
          value={currentId || ""}
          onChange={(e) => selectLifeSpace(e.target.value)}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid var(--border)", fontSize: 14 }}
        >
          {lifeSpaces.map((ls) => (
            <option key={ls.id} value={ls.id}>
              {ls.title}
            </option>
          ))}
        </select>
      ) : (
        <Link to="/app/life-spaces" className="btn btn-primary btn-sm">
          + Create Life Space
        </Link>
      )}
    </div>
  );
}
