import { useEffect, useRef, useState } from "react";
import { ORG_COMMAND_FIELDS, validateOrgCommandPreview } from "../utils/orgCommands.js";
import { chooseOrgConversation, orgConversationTurn } from "../utils/orgConversation.js";
import { isLocalMode } from "../services/sheetsApi";

function display(field, value, model) {
  if (!value) return field === "startDate" || field === "endDate" ? "No time limit" : "Blank";
  if (field === "domain") return model.domains.find((item) => item.id === value)?.name || value;
  if (field === "team") return model.teams.find((item) => item.id === value)?.label || value;
  return value;
}

export default function OrgCommandChat({ model, canEdit, unavailableReason, onSave, onRemove, onRequestUnlock }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const toggleRef = useRef(null);
  const bodyRef = useRef(null);
  const saving = useRef(false);
  useEffect(() => {
    if (open) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [open, pending, messages, error]);
  const examplePerson = model.people[0]?.name || "Example Person";
  const exampleDomain = model.domains[0]?.name || "Example Domain";
  const currentYear = new Date().getFullYear();
  const addMessage = (speaker, text) => setMessages((previous) => [...previous, { speaker, text }].slice(-20));
  const close = () => { setOpen(false); toggleRef.current?.focus(); };
  const submit = (event) => {
    event.preventDefault();
    if (busy || !input.trim()) return;
    setError("");
    addMessage("You", input.trim());
    try {
      const result = orgConversationTurn(input, pending, model);
      if (result.kind === "cancelled") { setPending(null); setInput(""); addMessage("Assistant", "Cancelled. No changes saved. Describe a new request whenever you're ready."); return; }
      setPending(result);
      addMessage("Assistant", result.kind === "choose" ? "Which assignment do you mean? These matches include past and future entries." : result.kind === "clarify" ? result.question : "Review the change below. Nothing has been saved yet.");
      setInput("");
    } catch (err) { setError(err.message); }
  };
  const choose = (id) => {
    setError("");
    try { setPending(chooseOrgConversation(pending, id, model)); }
    catch (err) { setError(err.message); }
  };
  const clarify = (value) => {
    setError("");
    try {
      const result = chooseOrgConversation(pending, value, model);
      setPending(result);
      addMessage("Assistant", result.kind === "clarify" ? result.question : "Review the change below. Nothing has been saved yet.");
    } catch (err) { setError(err.message); }
  };
  const confirm = async () => {
    if (saving.current) return;
    setError("");
    if (!canEdit) { setError(unavailableReason); return; }
    saving.current = true; setBusy(true);
    try {
      const row = validateOrgCommandPreview(pending, model);
      const removing = pending.action === "remove";
      if (removing) await onRemove(row);
      else {
        if (row.personName && !row.personId) row.personId = crypto.randomUUID();
        await onSave(row);
      }
      setPending(null);
      addMessage("Assistant", removing ? (isLocalMode() ? "Removed this assignment from the browser only." : "Removed this exact assignment from Google Sheets. Other assignments are unchanged.") : isLocalMode() ? "Saved in this browser only. The live Google Sheet was not changed." : "Saved to Google Sheets. Your current page, filters, and snapshot date are unchanged; use All assignments if the entry is outside this date.");
    } catch (err) { setError(`${err.message} The save was not confirmed. Refresh the directory and submit the command again before retrying.`); setPending(null); }
    finally { saving.current = false; setBusy(false); }
  };
  return (
    <aside className="org-chat" aria-label="Organization command assistant">
      <button ref={toggleRef} type="button" className="org-primary org-chat-toggle" aria-expanded={open} aria-controls="org-command-panel" disabled={busy} onClick={() => {
        if (open) close();
        else { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }
      }}>{open ? "Close assistant" : "Edit with chat"}</button>
      {open ? <section id="org-command-panel" className="org-chat-panel" aria-label="Edit organization with guided commands" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); close(); }
      }}>
        <header><strong>Organization assistant</strong><span>Guided commands · no external AI</span></header>
        <div ref={bodyRef} className="org-chat-body">
          <p>Describe a change in your own words. I match names and domains against the directory and keep your answers until the request is ready. Uncertain matches need your confirmation. Nothing saves before you confirm the preview.</p>
          <details><summary>Commands & examples</summary>
            <p>Use a sentence or separate fields with commas, “and,” semicolons, or new lines. Dates can be October 12th, 12 Oct, or YYYY-MM-DD. If you omit the year, I use the current year ({currentYear}), not the snapshot year. Ambiguous numeric dates need a spelled-out month.</p>
            <p>Any start or end date omitted from a command defaults to no time limit, including when updating an existing assignment.</p>
            <p>A team is optional for all people, including leaders, PMs, and engineers. New assignments have no team unless you explicitly provide one. Existing teams are kept on updates unless you clear them.</p>
            <ul>
              <li><code>update {examplePerson} in {exampleDomain}: start 2026-12-15; end blank</code></li>
              <li><code>end {examplePerson} in {exampleDomain} on 2026-12-31</code></li>
              <li><code>assign New Person to {exampleDomain} as Engineer; organization Relias; team Exact Team Name</code></li>
              <li><code>add {examplePerson} as PM for {exampleDomain}</code></li>
              <li><code>Can you please add {examplePerson} for {exampleDomain}, starting from October 12th</code></li>
              <li><code>Set {examplePerson}'s end date to December 31</code></li>
              <li><code>remove {examplePerson} from PM on {exampleDomain}</code></li>
              <li><code>update {examplePerson}: domain {exampleDomain}; role PM; name New Name; notes Updated assignment</code></li>
            </ul>
            <p>Editable fields: domain, name, role, team, organization, status, notes, start, end. Quote text containing semicolons. To find rows without a person, use <code>team allocation</code>, <code>open PM</code> (or another role), or <code>UX None</code> instead of a name.</p>
            <p>Details can arrive in different orders or separate replies. Short names and close spellings find directory matches; uncertain matches are offered for confirmation. I reuse unambiguous existing details and ask for anything missing. Reply in the box or choose an option. Say “cancel” to start over.</p>
            <p>Each request changes or removes one assignment. Removal deletes that row's recorded history; end-date it instead if you want to preserve history. Reference lists, bulk changes, and unrestricted AI conversation are not supported.</p>
          </details>
          {!canEdit ? <p className="org-chat-warning">{unavailableReason} <button type="button" onClick={onRequestUnlock}>Go to edit controls</button></p> : null}
          <div className="org-chat-messages" role="log" aria-label="Command conversation" aria-live="polite" aria-relevant="additions">
            {messages.map((message, index) => <p key={index} className={message.speaker === "You" ? "org-chat-user" : ""}><strong>{message.speaker}</strong><span>{message.text}</span></p>)}
          </div>
          {pending?.kind === "choose" ? <div className="org-chat-choices"><h3>Select the exact assignment</h3>
            {pending.candidates.map((row, index) => <button type="button" key={`${row.id}:${index}`} onClick={() => choose(row.id)}>
              {index + 1}. {row.personName || row.status} · {row.domainName} · {row.role} · {row.organization || "No organization"}{row.teamName ? ` · ${row.teamName}` : ""}
              <small>{row.startDate || "No start limit"} to {row.endDate || "No end limit"}</small>
            </button>)}
          </div> : null}
          {pending?.kind === "clarify" ? <div className="org-chat-choices"><h3>{pending.question}</h3>
            <p>Keeping: {pending.command.action || "action not yet specified"} · {pending.command.target || "person not yet specified"} · {display("domain", pending.command.domain, model)}{pending.command.changes.role ? ` · ${pending.command.changes.role}` : ""}<br />Start: {pending.command.changes.startDate || "No time limit"} · End: {pending.command.changes.endDate || "No time limit"}</p>
            {pending.options.map((option, index) => <button key={`${option.value}:${index}`} type="button" onClick={() => clarify(option.value)}>{option.label}</button>)}
          </div> : null}
          {pending?.kind === "preview" ? <div className="org-chat-preview">
            <h3>{pending.action === "remove" ? "Remove one assignment" : pending.before ? "Update one assignment" : "Add one assignment"}</h3>
            <p>{pending.before?.personName || pending.row.personName || pending.row.status} · {display("domain", pending.before?.domain || pending.row.domain, model)} · {pending.before?.role || pending.row.role}</p>
            {pending.before ? <p>{display("organization", pending.before.organization, model)} · {display("team", pending.before.team, model)}<br />{pending.before.startDate || "No start limit"} to {pending.before.endDate || "No end limit"}</p> : null}
            <dl>{pending.differences.map(({ field, before, after }) => <div key={field}><dt>{ORG_COMMAND_FIELDS[field]}</dt><dd>{pending.before ? <><span className="org-chat-before">{display(field, before, model)}</span><span aria-label="changes to"> → </span></> : null}<strong>{display(field, after, model)}</strong></dd></div>)}</dl>
            <p>{pending.action === "remove" ? "This permanently removes only this assignment, including its recorded history. Other roles and domains for this person are not affected. To preserve history, cancel and set an end date instead." : "End dates are inclusive. This changes only this row; moving its domain or renaming it does not preserve the old row as history."}</p>
            <div className="org-actions"><button type="button" disabled={busy} onClick={() => { setPending(null); inputRef.current?.focus(); }}>Cancel</button>
              <button type="button" className="org-primary" disabled={busy || !canEdit} onClick={confirm}>{busy ? "Saving…" : pending.action === "remove" ? "Confirm removal" : isLocalMode() ? "Confirm browser save" : "Confirm & save to Sheet"}</button></div>
          </div> : null}
          {error ? <p role="alert" className="org-chat-warning">{error}</p> : null}
        </div>
        <form className="org-chat-composer" onSubmit={submit}>
          <label htmlFor="org-command-input">{pending?.kind === "clarify" || pending?.kind === "choose" ? "Your reply (previous details are kept)" : "Your request"}</label>
          <textarea ref={inputRef} id="org-command-input" rows={2} maxLength={2000} required disabled={busy} value={input} placeholder={`update ${examplePerson}: end 2026-12-31`} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
          }} />
          <button type="submit" disabled={busy || !input.trim()}>Preview change</button>
        </form>
      </section> : null}
    </aside>
  );
}
