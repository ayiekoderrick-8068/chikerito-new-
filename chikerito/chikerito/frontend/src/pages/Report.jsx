import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import MilestoneReport from "../components/MilestoneReport.jsx";

export default function Report() {
  const { currentId, current } = useLifeSpace();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const reportRef = useRef(null);

  useEffect(() => {
    if (!currentId) return;
    setLoading(true);
    setError("");
    api.getDashboard(currentId).then(setData).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [currentId]);

  if (!currentId) {
    return (
      <>
        <Topbar title="Progress Report" />
        <div className="page-body"><div className="empty-state card">Create a Life Space first to generate a report.</div></div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Topbar title="Progress Report" />
        <div className="page-body"><div className="empty-state card error-banner">{error}</div></div>
      </>
    );
  }

  if (loading || !data) {
    return (
      <>
        <Topbar title="Progress Report" />
        <div className="page-body">Loading report...</div>
      </>
    );
  }

  const shareUrl = `${window.location.origin}/report/${current.slug}`;

  async function handleCopyLink() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownload() {
    if (!reportRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(reportRef.current, { pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `${current.slug || "milestone"}-report.png`;
      link.href = dataUrl;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Topbar title="Progress Report" />
      <div className="page-body">
        <div className="report-toolbar">
          <button className="btn btn-primary btn-sm" onClick={handleDownload} disabled={downloading}>
            {downloading ? "Preparing..." : "⬇ Download PNG"}
          </button>
          <button className="btn btn-outline btn-sm" onClick={handleCopyLink}>
            {copied ? "Link copied!" : "🔗 Copy shareable link"}
          </button>
        </div>
        <div className="report-wrap">
          <MilestoneReport ref={reportRef} lifeSpace={data.lifeSpace} stats={data.stats} categoryBreakdown={data.categoryBreakdown} />
        </div>
      </div>
    </>
  );
}
