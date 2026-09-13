import { useEffect, useRef } from "react";
import { api } from "./api";

export function useListingActivity(items, userId, loading, modalOpen) {
  const grid = useRef(null);
  useEffect(() => {
    if (!grid.current || !userId || loading || modalOpen || !window.IntersectionObserver) return;
    const timers = new Map();
    const pending = new Set();
    let flush;
    const cards = [...grid.current.querySelectorAll("[data-listing-id]")];
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const card = entry.target;
        if (entry.isIntersecting) card.classList.add("is-visible");
        if (entry.intersectionRatio >= 0.5 && document.visibilityState === "visible" && card.dataset.countImpression === "true") {
          if (timers.has(card)) continue;
          timers.set(card, setTimeout(() => {
            if (document.visibilityState !== "visible") { timers.delete(card); return; }
            pending.add(card.dataset.listingId);
            observer.unobserve(card);
            clearTimeout(flush);
            flush = setTimeout(() => {
              const ids = [...pending];
              pending.clear();
              if (ids.length) api("/listings/impressions", { method: "POST", body: { ids } }).catch(() => {});
            }, 200);
          }, 1000));
        } else {
          clearTimeout(timers.get(card));
          timers.delete(card);
        }
      }
    }, { threshold: [0, 0.15, 0.5] });
    cards.forEach(card => { card.classList.add("reveal-ready"); observer.observe(card); });
    const visibility = () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      if (document.visibilityState === "visible") cards.forEach(card => { observer.unobserve(card); observer.observe(card); });
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      for (const timer of timers.values()) clearTimeout(timer);
      clearTimeout(flush);
      cards.forEach(card => card.classList.remove("reveal-ready"));
    };
  }, [items, userId, loading, modalOpen]);
  return grid;
}
