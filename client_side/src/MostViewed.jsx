import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, MapPin, TrendingUp } from "lucide-react";
import { api, money } from "./api";
import { useListingActivity } from "./useListingActivity";

export default function MostViewed({ userId, refresh, modalOpen, onOpen, onCreate }) {
  const [result, setResult] = useState({ items: [], loading: true, error: "" });
  const [retry, setRetry] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: true });
  const { items, loading, error } = result;
  const track = useListingActivity(items, userId, loading, modalOpen);

  useEffect(() => {
    let alive = true;
    api("/listings/most-viewed")
      .then(data => {
        if (alive) setResult({ items: data.items, loading: false, error: "" });
      })
      .catch(e => {
        if (alive) setResult({ items: [], loading: false, error: e.message });
      });
    return () => { alive = false; };
  }, [userId, refresh, retry]);

  useEffect(() => {
    const element = track.current;
    if (!element) return;
    function measure() {
      const start = element.scrollLeft <= 2;
      const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
      setEdges(previous => previous.start === start && previous.end === end ? previous : { start, end });
    }
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [items, track]);

  function move(direction) {
    const element = track.current;
    const card = element?.firstElementChild;
    if (!card) return;
    const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
    element.scrollBy({
      left: direction * (card.getBoundingClientRect().width + gap),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  return (
    <section className="most-viewed" aria-labelledby="most-viewed-title" aria-roledescription="carousel">
      <div className="most-viewed-heading">
        <div>
          <span className="most-viewed-kicker"><TrendingUp size={15} /> THE CAMPUS SPOTLIGHT</span>
          <h2 id="most-viewed-title">Most viewed on campus</h2>
          <p>The finds getting the most attention. Highest impressions first.</p>
        </div>
        {!!items.length && <div className="carousel-controls">
          <button className="carousel-arrow" aria-label="Previous most-viewed item" aria-controls="most-viewed-track" disabled={edges.start} onClick={() => move(-1)}><ArrowLeft size={19} /></button>
          <button className="carousel-arrow" aria-label="Next most-viewed item" aria-controls="most-viewed-track" disabled={edges.end} onClick={() => move(1)}><ArrowRight size={19} /></button>
        </div>}
      </div>
      {loading ? (
        <div className="spotlight-skeletons" role="status" aria-label="Loading most-viewed listings">
          {[1, 2, 3, 4].map(n => <div className="skeleton-card" key={n} />)}
        </div>
      ) : error ? (
        <div className="spotlight-empty" role="status">
          <p>Couldn’t load the campus spotlight. {error}</p>
          <button className="text-button" onClick={() => { setResult({ items: [], loading: true, error: "" }); setRetry(n => n + 1); }}>Try again</button>
        </div>
      ) : items.length ? (
        <>
          <ol ref={track} id="most-viewed-track" className="most-viewed-track" tabIndex={0} aria-label="Products ranked by impressions; use left and right arrow keys to scroll" onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
          }}>
            {items.map((item, index) => (
              <li className="listing-card spotlight-card" key={item.id} data-listing-id={item.id} data-count-impression={!item.isOwner} style={{ "--reveal-delay": `${Math.min(index, 3) * 55}ms` }}>
                <button className="spotlight-card-link" onClick={() => onOpen(item.id)} aria-label={`View ${item.title}, ${money(item.price)}, ${item.impressions} impressions`}>
                  <span className="spotlight-photo">
                    <img src={item.images[0]?.url} alt={item.title} loading={index < 4 ? "eager" : "lazy"} />
                    <span className="spotlight-rank">#{index + 1}</span>
                    <span className="spotlight-condition">{item.condition}</span>
                  </span>
                  <span className="spotlight-body">
                    <span className="spotlight-category">{item.category}</span>
                    <span className="spotlight-title">{item.title}</span>
                    <span className="spotlight-price">{money(item.price)}</span>
                    <span className="spotlight-location"><MapPin size={12} />{item.location}</span>
                    <span className="spotlight-footer">
                      <span><Eye size={14} />{item.impressions.toLocaleString()} {item.impressions === 1 ? "impression" : "impressions"}</span>
                      <ArrowRight size={17} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="spotlight-caption"><span>Open a find for photos, details & seller chat.</span>{(!edges.start || !edges.end) && <span>Swipe or use the arrows <ArrowRight size={13} /></span>}</div>
        </>
      ) : (
        <div className="spotlight-empty">
          <p>Your next campus favourite could start here. Available student listings appear as soon as they’re published.</p>
          <button className="text-button" onClick={onCreate}>List an item <ArrowRight size={16} /></button>
        </div>
      )}
    </section>
  );
}
