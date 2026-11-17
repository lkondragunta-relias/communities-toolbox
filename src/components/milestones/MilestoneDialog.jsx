import { useEffect, useRef } from "react";
import Icon from "../Icon";

export default function MilestoneDialog({ title, children, onClose, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog ref={ref} className="milestone-dialog" aria-labelledby="milestone-dialog-title"
      onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}
      onKeyDown={event => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab") return;
        const controls = [...ref.current.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}>
      <header className="milestone-dialog__header">
        <h2 id="milestone-dialog-title">{title}</h2>
        <button type="button" className="milestone-icon-button" onClick={onClose} disabled={busy} aria-label="Close milestone panel"><Icon name="close" size={18} /></button>
      </header>
      {children}
    </dialog>
  );
}
