import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

export default function Modal({ title, children, onClose, wide = false, photo = false }) {
  const [closing, setClosing] = useState(false);
  const dialog = useRef(null);
  const timer = useRef(null);
  const dismiss = useCallback(() => {
    if (timer.current) return;
    setClosing(true);
    timer.current = setTimeout(onClose, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 170);
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    const background = previous?.closest('[role="dialog"]') || document.getElementById("root");
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    dialog.current.querySelector("button")?.focus();
    return () => {
      clearTimeout(timer.current);
      document.body.style.overflow = overflow;
      if (background) background.inert = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(<div className={`modal-backdrop ${closing ? "is-closing" : ""} ${photo ? "photo-backdrop" : ""}`}
    onClick={e => { if (e.target === e.currentTarget) dismiss(); }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? "wide" : ""} ${photo ? "photo-modal" : ""}`}
      onKeyDown={e => {
        if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
        if (e.key === "Tab") {
          e.stopPropagation();
          const nodes = [...e.currentTarget.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],iframe")].filter(node => node.getClientRects().length);
          const first = nodes[0], last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={dismiss}><X size={22} /></button></div>
      {children}
    </section>
  </div>, document.body);
}
