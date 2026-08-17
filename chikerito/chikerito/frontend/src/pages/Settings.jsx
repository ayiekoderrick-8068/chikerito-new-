import { useState } from "react";
import { useLifeSpace } from "../context/LifeSpaceContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../api";
import Topbar from "../components/Topbar.jsx";
import { fileToResizedDataUrl } from "../imageUtils.js";
import { can } from "../permissions.js";

export default function Settings() {
  const { current, refresh } = useLifeSpace();
  const { user } = useAuth();
  const canEditSettings = can(current?.role, "lifespace:edit_settings");
  const canEditVisibility = can(current?.role, "lifespace:edit_visibility");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");
  const [form, setForm] = useState(
    current
      ? {
          title: current.title,
          goalAmount: current.goal_amount,
          story: current.story,
          coverImage: current.cover_image || "",
          visibility: current.visibility,
          showBudgetPublic: current.show_budget_public,
          allowIndexing: current.allow_indexing,
        }
      : { title: "", goalAmount: 0, story: "", coverImage: "", visibility: "private", showBudgetPublic: false, allowIndexing: false }
  );
  const [requirePasscode, setRequirePasscode] = useState(current?.hasPasscode || false);
  const [passcodeInput, setPasscodeInput] = useState("");

  async function handleCoverChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    setImageError("");
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setForm((f) => ({ ...f, coverImage: dataUrl }));
    } catch (err) {
      setImageError(err.message);
    }
  }

  if (!current) {
    return (
      <>
        <Topbar title="Settings" />
        <div className="page-body"><div className="empty-state card">Create a Life Space to manage its settings.</div></div>
      </>
    );
  }

  if (!canEditSettings) {
    return (
      <>
        <Topbar title="Settings" />
        <div className="page-body">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Life Space Settings</h3>
            <p style={{ color: "var(--text-muted)" }}>Your role ({current.role.replace("_", " ")}) doesn't include editing this life space's settings.</p>
            <p><strong>Title:</strong> {current.title}</p>
            <p><strong>Visibility:</strong> {current.visibility}</p>
          </div>
        </div>
      </>
    );
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    if (canEditVisibility && requirePasscode && !current.hasPasscode && !passcodeInput.trim()) {
      setError('Enter a passcode, or turn off "Require a passcode".');
      return;
    }
    setSaving(true);
    setSaved(false);
    try {
      // Only the fields this role can actually change are sent — the backend
      // requires the stricter owner-only capability for the whole request if
      // any visibility/passcode field is present at all, even unchanged, so a
      // non-owner submitting them back verbatim would otherwise be rejected.
      const { visibility, showBudgetPublic, allowIndexing, ...basics } = form;
      const payload = canEditVisibility ? { ...form } : basics;
      if (canEditVisibility) {
        if (requirePasscode && passcodeInput.trim()) payload.passcode = passcodeInput.trim();
        else if (!requirePasscode && current.hasPasscode) payload.passcode = "";
      }
      await api.updateLifeSpace(current.id, payload);
      await refresh();
      setPasscodeInput("");
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const shareUrl = `${window.location.origin}/donate/${current.slug}`;

  return (
    <>
      <Topbar title="Settings" />
      <div className="page-body">
        <div className="two-col">
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Life Space Settings</h3>
            {saved && <div className="success-banner">Settings saved.</div>}
            {error && <div className="error-banner">{error}</div>}
            <form onSubmit={handleSave}>
              <div className="field">
                <label>Title</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="field">
                <label>Goal amount (USD)</label>
                <input type="number" value={form.goalAmount} onChange={(e) => setForm({ ...form, goalAmount: e.target.value })} />
              </div>
              <div className="field">
                <label>Story</label>
                <textarea rows={3} value={form.story} onChange={(e) => setForm({ ...form, story: e.target.value })} />
              </div>
              <div className="field">
                <label>Cover photo</label>
                <input type="file" accept="image/*" onChange={handleCoverChange} />
                {imageError && <div className="error-banner" style={{ marginTop: 8 }}>{imageError}</div>}
                {form.coverImage && (
                  <img src={form.coverImage} alt="Cover preview" style={{ marginTop: 10, width: "100%", maxHeight: 140, objectFit: "cover", borderRadius: 10 }} />
                )}
              </div>

              {canEditVisibility && (
                <>
                  <hr className="field-divider" />

                  <div className="field">
                    <label>Event Visibility</label>
                    <label className="radio-option">
                      <input type="radio" name="visibility" checked={form.visibility === "private"} onChange={() => setForm({ ...form, visibility: "private" })} />
                      <div>
                        <div className="radio-title">Private</div>
                        <div className="radio-sub">Only you and invited collaborators can access this event.</div>
                      </div>
                    </label>
                    <label className="radio-option">
                      <input type="radio" name="visibility" checked={form.visibility === "public"} onChange={() => setForm({ ...form, visibility: "public" })} />
                      <div>
                        <div className="radio-title">Public</div>
                        <div className="radio-sub">Anyone with the link can view the public event page without logging in.</div>
                      </div>
                    </label>
                  </div>

                  {form.visibility === "public" && (
                    <div className="visibility-subpanel">
                      <label className="checkbox-option">
                        <input type="checkbox" checked={form.showBudgetPublic} onChange={(e) => setForm({ ...form, showBudgetPublic: e.target.checked })} />
                        Show budget &amp; expense breakdown publicly
                      </label>
                      <label className="checkbox-option">
                        <input type="checkbox" checked={form.allowIndexing} onChange={(e) => setForm({ ...form, allowIndexing: e.target.checked })} />
                        Allow search engines to find this page
                      </label>
                      <label className="checkbox-option">
                        <input type="checkbox" checked={requirePasscode} onChange={(e) => setRequirePasscode(e.target.checked)} />
                        Require a passcode
                      </label>
                      {requirePasscode && (
                        <input
                          type="text"
                          placeholder={current.hasPasscode ? "Enter a new passcode to change it" : "Set a passcode"}
                          value={passcodeInput}
                          onChange={(e) => setPasscodeInput(e.target.value)}
                          style={{ marginTop: 8 }}
                        />
                      )}

                      <div className="share-url-row">
                        <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
                          Copy
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.open(shareUrl, "_blank")}>
                          Preview Public Page ↗
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              <button className="btn btn-primary" style={{ marginTop: 20 }} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Account</h3>
            <p><strong>Name:</strong> {user?.firstName} {user?.lastName}</p>
            <p><strong>Email:</strong> {user?.email}</p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 20 }}>
              Chikerito — The Operating System for Life's Biggest Moments.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
