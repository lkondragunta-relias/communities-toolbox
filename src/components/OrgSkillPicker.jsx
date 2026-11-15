import { useEffect, useRef } from "react";

export default function OrgSkillPicker({ skills, value, onChange, disabled = false, label = "Skills", placeholder = "Choose skills" }) {
  const detailsRef = useRef(null);

  useEffect(() => {
    const handleClick = (event) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target)) details.open = false;
    };
    const handleKeyDown = (event) => {
      const details = detailsRef.current;
      if (event.key === "Escape" && details?.open) details.open = false;
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return <div className="org-field org-skill-picker">
    <span>{label}</span>
    <details ref={detailsRef}>
      <summary aria-disabled={disabled}>{value.length ? `${value.length} selected: ${skills.filter((s) => value.includes(s.id)).map((s) => s.name).join(", ")}` : placeholder}</summary>
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
