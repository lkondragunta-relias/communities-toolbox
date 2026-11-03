export default function OrgSkillPicker({ skills, value, onChange, disabled = false, label = "Skills" }) {
  return <div className="org-field org-skill-picker">
    <span>{label}</span>
    <details>
      <summary aria-disabled={disabled}>{value.length ? `${value.length} selected: ${skills.filter((s) => value.includes(s.id)).map((s) => s.name).join(", ")}` : "Choose skills"}</summary>
      <fieldset disabled={disabled}>
        <legend className="org-sr-only">{label}</legend>
        {skills.map((skill) => <label key={skill.id}><input type="checkbox" checked={value.includes(skill.id)}
          onChange={(event) => onChange(event.target.checked ? [...value, skill.id] : value.filter((id) => id !== skill.id))} />{skill.name}</label>)}
        {!skills.length ? <p>No skills in the catalog yet.</p> : null}
        <button type="button" onClick={() => onChange([])}>Clear selection</button>
      </fieldset>
    </details>
  </div>;
}
