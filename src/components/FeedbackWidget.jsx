import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { ROUTES } from "../config/navigation.js";
import { FEEDBACK_CATEGORIES, FEEDBACK_LIMITS, validateFeedback } from "../config/feedbackConfig.js";
import { checkFeedbackSupport, isLocalMode, submitFeedback } from "../services/sheetsApi.js";
import "../styles/feedback.css";

export default function FeedbackWidget({ view }) {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const sending = useRef(false);
  const pending = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", category: "Share feedback", page: view, message: "" });
  const [support, setSupport] = useState("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    checkFeedbackSupport().then(() => {
      if (active) setSupport("ready");
    }).catch((err) => {
      if (active) {
        setSupport("unavailable");
        setError(err.message || "Feedback is unavailable. Please try again later.");
      }
    });
    return () => { active = false; };
  }, [open]);

  function close() {
    dialog.current.close();
  }

  function show() {
    if (!pending.current) setDraft((previous) => ({ ...previous, page: view }));
    setSaved(false);
    setError("");
    setSupport("checking");
    setOpen(true);
    dialog.current.showModal();
    dialog.current.querySelector("#feedback-name:not(:disabled)")?.focus();
  }

  async function send(event) {
    event.preventDefault();
    if (sending.current || support !== "ready") return;
    let input;
    try {
      input = pending.current || validateFeedback({ ...draft, requestId: crypto.randomUUID() });
    } catch (err) {
      setError(err.message);
      return;
    }
    sending.current = true;
    pending.current = input;
    setBusy(true);
    setError("");
    try {
      await submitFeedback(input);
      pending.current = null;
      setRetry(false);
      setDraft({ name: "", category: "Share feedback", page: view, message: "" });
      setSaved(true);
    } catch (err) {
      setRetry(true);
      setError(`${err.message || "We could not confirm your submission."} Your draft is kept. Retry sends the same request, not a second entry.`);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function change(event) {
    const { name, value } = event.target;
    setDraft((previous) => ({ ...previous, [name]: value }));
    setError("");
  }

  return (
    <>
      <button ref={trigger} type="button" className="feedback-trigger" onClick={show}
        aria-label="Send feedback" aria-haspopup="dialog" aria-expanded={open} title="Feedback">
        <Icon name="feedback" size={24} />
        <span>Feedback</span>
      </button>
      <dialog ref={dialog} className="feedback-panel" aria-labelledby="feedback-title"
        aria-describedby="feedback-description"
        onCancel={(event) => { event.stopPropagation(); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
          if (event.key !== "Tab") return;
          const controls = [...dialog.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
          const first = controls[0];
          const last = controls[controls.length - 1];
          if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          }
        }}
        onClose={() => { setOpen(false); trigger.current?.focus(); }}>
        <header className="feedback-panel__header">
          <div className="feedback-panel__mark"><Icon name="feedback" size={24} /></div>
          <div>
            <h2 id="feedback-title">Help us make it better</h2>
            <p id="feedback-description">A bug, an idea, or a small correction. We are listening.</p>
          </div>
          <button type="button" className="feedback-panel__close" aria-label="Close feedback" onClick={close}>
            <Icon name="close" size={20} />
          </button>
        </header>
        {saved ? (
          <div className="feedback-panel__success">
            <p role="status">Thank you! Your feedback has been sent.</p>
            <button type="button" className="feedback-panel__send" onClick={close} autoFocus>Done</button>
          </div>
        ) : (
          <form onSubmit={send} className="feedback-panel__form" aria-busy={busy}>
            <fieldset disabled={busy || retry}>
              <label htmlFor="feedback-name">Name <span>(required)</span></label>
              <input id="feedback-name" name="name" autoComplete="name" autoFocus required
                maxLength={FEEDBACK_LIMITS.name} value={draft.name} onChange={change} placeholder="Your name" />
              <div className="feedback-panel__row">
                <div>
                  <label htmlFor="feedback-category">What would you like to share?</label>
                  <select id="feedback-category" name="category" value={draft.category} onChange={change}>
                    {FEEDBACK_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="feedback-page">Page</label>
                  <select id="feedback-page" name="page" value={draft.page} onChange={change}>
                    {ROUTES.map((route) => <option key={route.id} value={route.id}>{route.label}</option>)}
                  </select>
                </div>
              </div>
              <label htmlFor="feedback-message">Message <span>(required)</span></label>
              <textarea id="feedback-message" name="message" rows={5} required maxLength={FEEDBACK_LIMITS.message}
                value={draft.message} onChange={change} placeholder="Tell us what happened or what would help..." />
              <p className="feedback-panel__count">{draft.message.length} / {FEEDBACK_LIMITS.message}</p>
            </fieldset>
            <div className="feedback-panel__status" aria-live="polite">
              {support === "checking" ? <p>Checking feedback availability...</p> : null}
              {error ? <p role="alert" className="feedback-panel__error">{error}</p> : null}
            </div>
            <footer>
              <p>{isLocalMode() ? "Local demo: saved only in this browser." : "Sent to the Communities team. No email needed."}</p>
              <button className="feedback-panel__send" type="submit" disabled={busy || support !== "ready"}>
                <Icon name="send" size={16} /> {busy ? "Sending..." : retry ? "Retry send" : "Send"}
              </button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
