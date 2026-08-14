import { useState } from "react";

export default function PasscodeGate({ onSubmit, error }) {
  const [passcode, setPasscode] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (passcode.trim()) onSubmit(passcode.trim());
  }

  return (
    <div className="card" style={{ maxWidth: 380, margin: "60px auto", textAlign: "center" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
      <h2 style={{ marginTop: 0 }}>Passcode required</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>The organizer protected this page with a passcode.</p>
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field" style={{ textAlign: "left" }}>
          <input
            autoFocus
            type="text"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Enter passcode"
          />
        </div>
        <button className="btn btn-primary" style={{ width: "100%" }} disabled={!passcode.trim()}>Continue</button>
      </form>
    </div>
  );
}
