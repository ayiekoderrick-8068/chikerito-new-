import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { api } from "../api";
import PasscodeGate from "../components/PasscodeGate.jsx";
import NoIndexTag from "../components/NoIndexTag.jsx";
import { getStoredPasscode, storePasscode } from "../publicAccess.js";
import { FALLBACK_CURRENCIES, formatMoney } from "../currency.js";

export default function DonatePage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const [access, setAccess] = useState("loading"); // loading | private | passcode | ready | error
  const [passcodeError, setPasscodeError] = useState("");
  const [notFoundError, setNotFoundError] = useState("");
  const [event, setEvent] = useState(null);
  const [passcode, setPasscode] = useState(getStoredPasscode(slug));

  const [amount, setAmount] = useState(50);
  const [currency, setCurrency] = useState("USD");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState(() => searchParams.get("payment") === "success" ? "done" : "idle");
  const [error, setError] = useState("");

  function load(withPasscode) {
    setAccess("loading");
    api
      .getPublicReport(slug, withPasscode)
      .then((data) => {
        setEvent(data);
        setCurrency(data.lifeSpace.currency || "USD");
        setAccess("ready");
      })
      .catch((err) => {
        if (err.data?.private) setAccess("private");
        else if (err.data?.passcodeRequired) {
          setPasscodeError(withPasscode ? "Incorrect passcode." : "");
          setAccess("passcode");
        } else {
          setNotFoundError(err.message);
          setAccess("error");
        }
      });
  }

  useEffect(() => {
    load(passcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  function handlePasscodeSubmit(code) {
    storePasscode(slug, code);
    setPasscode(code);
    load(code);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setStatus("loading");
    try {
      const result = await api.publicContribute(slug, {
        contributorName: name || "Anonymous",
        amount: Number(amount),
        currency,
        message,
      }, passcode);
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
      else setStatus("done");
    } catch (err) {
      setError(err.message);
      setStatus("idle");
    }
  }

  return (
    <div className="auth-shell">
      <NoIndexTag allow={event?.lifeSpace?.allowIndexing} />
      <div className="auth-card">
        <Link to="/" className="brand" style={{ display: "block", marginBottom: 24, color: "#1b2a4a" }}>
          Chikerito<span className="dot" style={{ color: "#b08d57" }}>.</span>
        </Link>

        {access === "loading" && <div className="card">Loading...</div>}

        {access === "private" && (
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <h1 style={{ fontSize: 22 }}>This event is private</h1>
            <p style={{ color: "#6b7280" }}>The organizer hasn't made this Life Space public yet.</p>
          </div>
        )}

        {access === "passcode" && <PasscodeGate onSubmit={handlePasscodeSubmit} error={passcodeError} />}

        {access === "error" && (
          <div className="card" style={{ textAlign: "center" }}>
            <h1 style={{ fontSize: 22 }}>Not found</h1>
            <p style={{ color: "#6b7280" }}>{notFoundError}</p>
          </div>
        )}

        {access === "ready" && (
          status === "done" ? (
            <div className="card" style={{ textAlign: "center" }}>
              <h1 style={{ fontSize: 24 }}>Thank you! 💛</h1>
              <p style={{ color: "#6b7280" }}>Your contribution of {formatMoney(amount, currency, { showCode: true })} has been recorded and the organizer has been notified.</p>
            </div>
          ) : (
            <div className="card">
              <h1 style={{ fontSize: 24, marginBottom: 4 }}>{event.lifeSpace.title}</h1>
              {event.lifeSpace.story && <p className="sub">{event.lifeSpace.story}</p>}
              {event.stats.goal > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${event.stats.progress}%` }} /></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", marginTop: 6 }}>
                    <span>{formatMoney(event.stats.raised, event.lifeSpace.currency)} raised</span>
                    <span>Goal: {formatMoney(event.stats.goal, event.lifeSpace.currency)}</span>
                  </div>
                </div>
              )}
              {error && <div className="error-banner">{error}</div>}
              <form onSubmit={handleSubmit}>
                <div className="field">
                  <label>Your name (optional)</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anonymous" />
                </div>
                <div className="field">
                  <label>Amount ({currency})</label>
                  <input type="number" min="1" required value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="donation-currency">Currency</label>
                  <select id="donation-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {FALLBACK_CURRENCIES.map((option) => <option key={option.code} value={option.code}>{option.code} — {option.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Message (optional)</label>
                  <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
                <button className="btn btn-gold" style={{ width: "100%" }} disabled={status === "loading"}>
                  {status === "loading" ? "Processing..." : `Contribute ${formatMoney(amount, currency)}`}
                </button>
              </form>
            </div>
          )
        )}
      </div>
    </div>
  );
}
