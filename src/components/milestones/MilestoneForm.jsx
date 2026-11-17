import { useState } from "react";
import { MILESTONE_LIMITS, MILESTONE_STATUSES, validateMilestoneFields } from "../../config/milestoneConfig.js";
import MilestoneDialog from "./MilestoneDialog";

export default function MilestoneForm({ item, domains, onSave, onClose, busy, pending, error }) {
  const [form, setForm] = useState(() => ({
    domainIds: item?.domainIds || [], title: item?.title || "", date: item?.date || "",
    status: item?.status || "Completed", impact: item?.impact || "", details: item?.details || "",
    links: (item?.links || []).join("\n"),
  }));
  const [validation, setValidation] = useState("");
  function change(event) {
    setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
    setValidation("");
  }
  function toggle(id) {
    setForm(previous => ({ ...previous, domainIds: previous.domainIds.includes(id) ? previous.domainIds.filter(value => value !== id) : [...previous.domainIds, id] }));
    setValidation("");
  }
  function submit(event) {
    event.preventDefault();
    if (pending) { onSave(null); return; }
    try {
      const fields = validateMilestoneFields({ ...form, links: form.links.split("\n").map(link => link.trim()).filter(Boolean) }, domains);
      setValidation("");
      onSave(fields);
    } catch (err) {
      setValidation(err.message);
    }
  }
  return (
    <MilestoneDialog title={item ? "Edit milestone" : "Add milestone"} onClose={onClose} busy={busy}>
      <form className="milestone-form" onSubmit={submit} aria-busy={busy}>
        <p className="milestone-muted">One achievement can belong to several roadmap domains. Shared achievements are counted once.</p>
        <fieldset disabled={busy || Boolean(pending)}>
          <fieldset className="milestone-form__domains">
            <legend>Domains (required)</legend>
            {domains.map(domain => <label key={domain.id} className="milestone-check"><input type="checkbox" checked={form.domainIds.includes(domain.id)} onChange={() => toggle(domain.id)} />{domain.name}</label>)}
          </fieldset>
          <label htmlFor="milestone-title">Title (required)</label>
          <input id="milestone-title" name="title" required maxLength={MILESTONE_LIMITS.title} value={form.title} onChange={change} />
          <div className="milestone-form__row">
            <div><label htmlFor="milestone-date">Date (required)</label><input id="milestone-date" name="date" type="date" min="1000-01-01" max="9999-12-31" required value={form.date} onChange={change} /></div>
            <div><label htmlFor="milestone-status">Status</label><select id="milestone-status" name="status" value={form.status} onChange={change}>{MILESTONE_STATUSES.map(status => <option key={status}>{status}</option>)}</select></div>
          </div>
          <p className="milestone-help">Dates are calendar dates. Planned milestones stay Planned until explicitly marked Completed.</p>
          <label htmlFor="milestone-impact">Impact (required)</label>
          <textarea id="milestone-impact" name="impact" required rows={2} maxLength={MILESTONE_LIMITS.impact} value={form.impact} onChange={change} placeholder="One short sentence about why this matters." />
          <label htmlFor="milestone-details">Details (optional)</label>
          <textarea id="milestone-details" name="details" rows={4} maxLength={MILESTONE_LIMITS.details} value={form.details} onChange={change} />
          <label htmlFor="milestone-links">Evidence links (optional)</label>
          <textarea id="milestone-links" name="links" rows={3} maxLength={8007} value={form.links} onChange={change} aria-describedby="milestone-links-help" placeholder="https://..." />
          <p className="milestone-help" id="milestone-links-help">Up to 8 HTTPS URLs, one per line. No credentials in links.</p>
        </fieldset>
        {validation || error ? <p className="milestone-error" role="alert">{validation || error}</p> : null}
        {pending ? <p className="milestone-warning">An earlier write is unconfirmed. Your fields are kept and locked. Retry confirms the original request, not a second milestone.</p> : null}
        <footer className="milestone-form__footer">
          <button type="button" className="app__ghost-btn" disabled={busy} onClick={onClose}>{pending ? "Close and keep request" : "Cancel"}</button>
          <button className="app__add-btn" type="submit" disabled={busy}>{busy ? "Confirming..." : pending ? "Retry original request" : "Save milestone"}</button>
        </footer>
      </form>
    </MilestoneDialog>
  );
}
