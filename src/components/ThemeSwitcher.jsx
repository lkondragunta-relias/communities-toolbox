const OPTIONS = [
  { value: "system", label: "System", title: "Match device theme" },
  { value: "light", label: "Light", title: "Light theme" },
  { value: "dark", label: "Dark", title: "Dark theme" },
];

export default function ThemeSwitcher({ preference, onChange }) {
  return (
    <div
      className="theme-switcher"
      role="group"
      aria-label="Color theme"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-switcher__btn${preference === option.value ? " theme-switcher__btn--active" : ""}`}
          aria-pressed={preference === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
