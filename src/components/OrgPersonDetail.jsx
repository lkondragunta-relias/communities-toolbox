import { useState } from "react";
import { buildHash } from "../hooks/useRoute.js";
import { profileSnapshot, validGitHubUsername, WORK_FOCUS } from "../utils/orgSkills.js";
import OrgSkillPicker from "./OrgSkillPicker.jsx";

function SkillRow({ skill, model, onSave, onDelete, disabled }) {
  const [name, setName] = useState(skill.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const people = [...new Set(model.personSkills.filter((link) => link.skillId === skill.id).map((link) => link.personId))];
  const run = async (remove) => {
    if (remove && !window.confirm(`Delete "${skill.name}" from the catalog and remove it from ${people.length} people? Domain assignments are unchanged.`)) return;
    setBusy(true); setError("");
    try {
      if (remove) await onDelete({ id: skill.id, expectedName: skill.name, expectedPersonIds: people });
      else await onSave({ id: skill.id, name: name.trim(), expectedName: skill.name });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return <div className="org-skill-row">
    <form onSubmit={(event) => { event.preventDefault(); run(false); }}>
      <label><span className="org-sr-only">Rename {skill.name}</span><input required maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={busy || disabled} /></label>
      <span>{people.length} people</span>
      <button type="submit" disabled={busy || disabled || name.trim() === skill.name}>Rename</button>
      <button type="button" disabled={busy || disabled} onClick={() => run(true)}>Delete skill</button>
    </form>
    {error ? <p role="alert" className="roadmap__error">{error}</p> : null}
  </div>;
}

export function OrgSkillsManager({ model, onSave, onDelete, onCreated, onBusyChange, disabled = false, createOnly = false }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <details className="org-card org-skills-manager">
    <summary>{createOnly ? "Create a new skill" : "Manage skill catalog"}</summary>
    <p>{createOnly ? "The new skill becomes a catalog option and is selected for this person. Save the profile to assign it." : "Add skills even before assigning them to anyone. Renaming preserves assignments. Deleting removes the skill from everyone, not their domain assignments."}</p>
    <form className="org-actions" onSubmit={async (event) => {
      event.preventDefault(); setBusy(true); onBusyChange?.(true); setError("");
      try { const result = await onSave({ name: name.trim() }); setName(""); onCreated?.(result.skillId); }
      catch (err) { setError(err.message); }
      finally { setBusy(false); onBusyChange?.(false); }
    }}>
      <label>New skill <input required maxLength={100} value={name} disabled={busy || disabled} onChange={(event) => setName(event.target.value)} placeholder="For example, AI" /></label>
      <button type="submit" disabled={busy || disabled}>Add skill</button>
    </form>
    {error ? <p role="alert" className="roadmap__error">{error}</p> : null}
    {!createOnly ? model.skills.map((skill) => <SkillRow key={`${skill.id}:${skill.name}`} skill={skill} model={model} onSave={onSave} onDelete={onDelete} disabled={busy || disabled} />) : null}
  </details>;
}

function ProfileForm({ person, model, onSave, onCancel, onSaveSkill, onDeleteSkill }) {
  const [form, setForm] = useState(() => profileSnapshot(person));
  const [expected] = useState(() => profileSnapshot(person));
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="org-card">
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!validGitHubUsername(form.githubUsername.trim())) { setError("Enter a GitHub username, not a URL."); return; }
      setBusy(true); setError("");
      try { await onSave({ personId: person.key, ...form, githubUsername: form.githubUsername.trim(), expected }); onCancel(); }
      catch (err) { setError(err.message); }
      finally { setBusy(false); }
    }}>
      <h3>Edit person profile</h3>
      <fieldset disabled={busy || catalogBusy} className="org-profile-fields">
        <label className="org-field">Work focus<select value={form.workFocus} onChange={(e) => setForm((p) => ({ ...p, workFocus: e.target.value }))}>
          <option value="">Not specified</option>{WORK_FOCUS.map((focus) => <option key={focus}>{focus}</option>)}
        </select></label>
        <label className="org-field">GitHub username<input maxLength={39} value={form.githubUsername} onChange={(e) => setForm((p) => ({ ...p, githubUsername: e.target.value }))} placeholder="Username only" /></label>
        <OrgSkillPicker skills={model.skills} value={form.skillIds} onChange={(skillIds) => setForm((p) => ({ ...p, skillIds }))} disabled={busy || catalogBusy} />
      </fieldset>
      <p>Uncheck a skill to remove it from this person. It stays in the catalog. Leave work focus or GitHub blank if unknown.</p>
      {error ? <p role="alert" className="roadmap__error">{error}</p> : null}
      <div className="org-actions"><button type="button" disabled={busy || catalogBusy} onClick={onCancel}>Cancel</button><button type="submit" className="org-primary" disabled={busy || catalogBusy}>{busy ? "Saving..." : "Save profile"}</button></div>
    </form>
    <OrgSkillsManager model={model} createOnly disabled={busy} onBusyChange={setCatalogBusy} onSave={onSaveSkill} onDelete={onDeleteSkill} onCreated={(id) => setForm((p) => ({ ...p, skillIds: [...p.skillIds, id] }))} />
  </div>;
}

export default function OrgPersonDetail({ personId, fullModel, model, canEdit, supported, onSave, onSaveSkill, onDeleteSkill, dateScope }) {
  const person = fullModel.people.find((p) => p.key === personId);
  const [editing, setEditing] = useState(false);
  if (!person) return <section className="org-card"><h3>Person not found</h3><p>This person is not in the recorded organization assignments. Refresh or return to the directory.</p></section>;
  const scoped = model.people.find((p) => p.key === personId);
  const domains = model.domains.filter((domain) => scoped?.assignments.some((row) => row.domain === domain.id));
  return <div className="org-person-detail">
    <section className="org-card">
      <h3>{person.name}</h3><p>{person.organization}</p>
      <dl><dt>Work focus</dt><dd>{person.workFocus || "Not specified"}</dd>
        <dt>Skills</dt><dd>{person.skills.length ? <div className="org-chips">{person.skills.map((skill) => <span className="org-skill-tag" key={skill.id}>{skill.name}</span>)}</div> : "No skills recorded"}</dd>
        <dt>GitHub username</dt><dd>{person.githubUsername ? <a className="org-link" href={`https://github.com/${person.githubUsername}`} target="_blank" rel="noopener noreferrer">{person.githubUsername}</a> : "Not specified"}</dd>
      </dl>
      {canEdit ? <button type="button" className="org-primary" disabled={!supported || editing || person.key.startsWith("name:")} onClick={() => setEditing(true)}>Edit profile &amp; skills</button> : null}
      {canEdit && person.key.startsWith("name:") ? <p role="alert">Save an assignment for this person first to create a stable Person ID.</p> : null}
    </section>
    {editing && canEdit ? <ProfileForm key={person.key} person={person} model={fullModel} onSave={onSave} onCancel={() => setEditing(false)} onSaveSkill={onSaveSkill} onDeleteSkill={onDeleteSkill} /> : null}
    <section className="org-card"><h3>Assigned domains</h3>
      {domains.length ? <ul className="org-assignments">{domains.map((domain) => <li key={domain.id}><a className="org-link" href={buildHash("org", [domain.id, dateScope])}>{domain.name}</a><span>{[...new Set(scoped.assignments.filter((row) => row.domain === domain.id).map((row) => row.role))].join(", ")}</span></li>)}</ul> : <p>No assignments in this date scope.</p>}
    </section>
  </div>;
}
