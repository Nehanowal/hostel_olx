import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Package,
  Pause,
  Play,
} from "lucide-react";
import { api, money } from "./api";

export default function MostViewed({
  userId,
  endpoint = "/listings/popular",
  refresh,
  modalOpen,
  onOpen,
  onCreate,
}) {
  const [result, setResult] = useState({ items: [], loading: true, error: "" });
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    let alive = true;
    api(endpoint)
      .then((data) => {
        if (alive) setResult({ items: data.items.slice(0,12), loading: false, error: "" });
      })
      .catch((error) => {
        if (alive)
          setResult({ items: [], loading: false, error: error.message });
      });
    return () => {
      alive = false;
    };
  }, [userId, refresh, retry, endpoint]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => setReducedMotion(media.matches);
    const visibility = () => setHidden(document.hidden);
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  const count = result.items.length;
  const stopped =
    paused || hovered || focused || hidden || modalOpen || reducedMotion;
  useEffect(() => {
    if (stopped || count < 2) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % count),
      6000,
    );
    return () => window.clearInterval(timer);
  }, [stopped, count]);
  const item = result.items[index % count];
  function move(step) {
    setPaused(true);
    setIndex((i) => (i + step + count) % count);
  }
  return (
    <section
      className="hero-spotlight"
      aria-label="Popular on campus"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div className="spotlight-label">
        <span className="spotlight-dot" /> Popular on campus
      </div>
      {result.loading ? (
        <div className="spotlight-placeholder" role="status">
          Finding campus favourites…
        </div>
      ) : result.error ? (
        <div className="spotlight-placeholder">
          <p>Couldn’t load campus favourites.</p>
          <button onClick={() => setRetry((i) => i + 1)}>
            Try again <ArrowRight size={16} />
          </button>
        </div>
      ) : !item ? (
        <div className="spotlight-placeholder">
          <Package size={36} />
          <h2>A new home for your old favourite.</h2>
          <button onClick={onCreate}>
            List your first find <ArrowUpRight size={17} />
          </button>
        </div>
      ) : (
        <>
          <button
            className="spotlight-card"
            onClick={() => onOpen(item.id)}
            aria-label={`View ${item.title}, ${money(item.price)}`}
          >
            <div className="spotlight-photo" key={item.id}>
              {item.images[0] ? (
                <img src={item.images[0].url} alt="" />
              ) : (
                <Package size={50} />
              )}
              <span>{item.condition}</span>
            </div>
            <div className="spotlight-info">
              <div>
                <h2>{item.title}</h2>
                <p>{item.location}</p>
              </div>
              <strong>{money(item.price)}</strong>
              <ArrowUpRight size={20} />
            </div>
          </button>
          {count > 1 && (
            <div className="spotlight-controls">
              <button
                onClick={() => move(-1)}
                aria-label="Previous popular item"
              >
                <ArrowLeft size={17} />
              </button>
              <span aria-live={stopped ? "polite" : "off"}>
                {(index % count) + 1} / {count}
              </span>
              <button onClick={() => move(1)} aria-label="Next popular item">
                <ArrowRight size={17} />
              </button>
              {!reducedMotion && (
                <button
                  onClick={() => setPaused((v) => !v)}
                  aria-label={
                    paused ? "Start item rotation" : "Pause item rotation"
                  }
                >
                  {paused ? <Play size={15} /> : <Pause size={15} />}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
