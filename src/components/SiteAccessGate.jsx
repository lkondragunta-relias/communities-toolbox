import { useState } from "react";
import {
  applyAdminTokenFromUrl,
  clearStoredAdminTokens,
  getStoredAdminToken,
  setStoredAdminToken,
} from "../utils/adminAuth";

const configuredToken = (import.meta.env.VITE_ADMIN_TOKEN || "").trim();

function hasValidSessionToken() {
  if (!configuredToken) return false;

  const urlToken = applyAdminTokenFromUrl();
  const candidate = urlToken || getStoredAdminToken();
  if (candidate === configuredToken) return true;

  if (candidate) clearStoredAdminTokens();
  return false;
}

export default function SiteAccessGate({ children }) {
  const [unlocked, setUnlocked] = useState(hasValidSessionToken);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  if (!configuredToken) {
    return (
      <main className="access-gate">
        <section className="access-gate__panel" role="alert">
          <h1 className="access-gate__title">Site unavailable</h1>
          <p className="access-gate__description">
            VITE_ADMIN_TOKEN must be configured before this site can load.
          </p>
        </section>
      </main>
    );
  }

  if (unlocked) return children;

  const handleSubmit = (event) => {
    event.preventDefault();
    const candidate = token.trim();

    if (candidate !== configuredToken) {
      clearStoredAdminTokens();
      setError("Invalid admin password.");
      return;
    }

    setStoredAdminToken(candidate);
    setError("");
    setUnlocked(true);
  };

  return (
    <main className="access-gate">
      <form className="access-gate__panel" onSubmit={handleSubmit}>
        <div>
          <h1 className="access-gate__title">Community toolbox</h1>
          <p className="access-gate__description">Enter the admin password to continue.</p>
        </div>

        <label className="admin-field">
          <span className="admin-field__label">Admin password</span>
          <input
            type="password"
            className="admin-field__input"
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              if (error) setError("");
            }}
            autoComplete="current-password"
            autoFocus
            required
          />
        </label>

        {error ? (
          <p className="admin-modal__submit-error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className="admin-btn admin-btn--primary access-gate__submit">
          Unlock site
        </button>
      </form>
    </main>
  );
}
