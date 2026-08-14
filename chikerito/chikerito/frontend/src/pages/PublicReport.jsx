import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toPng } from "html-to-image";
import { api } from "../api";
import MilestoneReport from "../components/MilestoneReport.jsx";
import PasscodeGate from "../components/PasscodeGate.jsx";
import NoIndexTag from "../components/NoIndexTag.jsx";
import { getStoredPasscode, storePasscode } from "../publicAccess.js";

export default function PublicReport() {
  const { slug } = useParams();
  const [access, setAccess] = useState("loading"); // loading | private | passcode | ready | error
  const [passcodeError, setPasscodeError] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [passcode, setPasscode] = useState(getStoredPasscode(slug));
  const reportRef = useRef(null);

  function load(withPasscode) {
    setAccess("loading");
    api
      .getPublicReport(slug, withPasscode)
      .then((d) => {
        setData(d);
        setAccess("ready");
      })
      .catch((err) => {
        if (err.data?.private) setAccess("private");
        else if (err.data?.passcodeRequired) {
          setPasscodeError(withPasscode ? "Incorrect passcode." : "");
          setAccess("passcode");
        } else {
          setError(err.message);
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

  async function handleDownload() {
    if (!reportRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(reportRef.current, { pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `${slug}-report.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="public-report-page">
      <NoIndexTag allow={data?.lifeSpace?.allowIndexing} />
      <header className="nav">
        <div className="nav-inner">
          <Link to="/" className="brand">Chikerito<span className="dot">.</span></Link>
          {access === "ready" && <Link to={`/donate/${slug}`} className="btn btn-gold btn-sm">Support this milestone</Link>}
        </div>
      </header>

      <div className="report-toolbar" style={{ maxWidth: 900, margin: "24px auto 0" }}>
        {access === "ready" && (
          <button className="btn btn-primary btn-sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? "Preparing..." : "⬇ Download PNG"}
          </button>
        )}
      </div>

      <div className="report-wrap">
        {access === "loading" && <div className="empty-state card">Loading report...</div>}
        {access === "private" && (
          <div className="empty-state card">
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <h2 style={{ marginTop: 0 }}>This event is private</h2>
            <p>The organizer hasn't made this Life Space public yet.</p>
          </div>
        )}
        {access === "passcode" && <PasscodeGate onSubmit={handlePasscodeSubmit} error={passcodeError} />}
        {access === "error" && <div className="empty-state card">{error}</div>}
        {access === "ready" && (
          <MilestoneReport
            ref={reportRef}
            lifeSpace={data.lifeSpace}
            stats={data.stats}
            categoryBreakdown={data.categoryBreakdown}
            budgetVisible={data.budgetVisible}
          />
        )}
      </div>
    </div>
  );
}
