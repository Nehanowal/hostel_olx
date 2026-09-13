import { useEffect, useRef, useState } from "react";
import { api } from "./api";

let scriptPromise;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const timer = setTimeout(() => script.dispatchEvent(new Event("error")), 15000);
    script.onload = () => { clearTimeout(timer); resolve(window.google.accounts.id); };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      scriptPromise = undefined;
      reject(new Error("Google sign-in could not load. Check your connection and try again."));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export default function GoogleSignIn({ clientId, onLogin }) {
  const container = useRef(null);
  const login = useRef(onLogin);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading Google sign-in…");
  useEffect(() => { login.current = onLogin; }, [onLogin]);
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const google = await loadGoogle();
        if (cancelled) return;
        const { nonce } = await api("/auth/google/nonce", { method: "POST" });
        if (cancelled) return;
        google.initialize({
          client_id: clientId, nonce, auto_select: false, ux_mode: "popup",
          callback: async ({ credential }) => {
            if (cancelled) return;
            setStatus("Verifying your university account…");
            container.current?.replaceChildren();
            try {
              const result = await api("/auth/google", { method: "POST", body: { credential } });
              if (!cancelled) login.current(result.user);
            } catch (e) {
              if (!cancelled) { setError(e.message); setStatus(""); }
            }
          },
        });
        container.current.replaceChildren();
        google.renderButton(container.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "pill", width: Math.min(350, container.current.clientWidth || 280) });
        setStatus("");
      } catch (e) {
        if (!cancelled) { setError(e.message); setStatus(""); }
      }
    }
    start();
    return () => { cancelled = true; };
  }, [clientId, attempt]);
  return <div className="google-signin">
    <div ref={container} />
    {status && <p role="status">{status}</p>}
    {error && <><p className="error" role="alert">{error}</p><button className="secondary full" onClick={() => { setError(""); setStatus("Loading Google sign-in…"); setAttempt(n => n + 1); }}>Retry Google sign-in</button></>}
    <small>Choose your official university Google account. Your first sign-in creates your account automatically.</small>
  </div>;
}
