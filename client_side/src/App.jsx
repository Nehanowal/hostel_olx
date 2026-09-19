import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Plus,
  Heart,
  MessageCircle,
  ArrowUpRight,
  MapPin,
  SlidersHorizontal,
  BookOpen,
  Headphones,
  Lamp,
  Shirt,
  Bike,
  Package,
  LogOut,
  ShieldCheck,
  ArrowRight,
  X,
  Store,
  Check,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { api, money } from "./api";
import {
  ListingDetail,
  ListingForm,
  Inbox,
  ReportForm,
  Admin,
} from "./features";
import "./App.css";
import Modal from "./Modal";
import GoogleSignIn from "./GoogleSignIn";
import { useListingActivity } from "./useListingActivity";
import MostViewed from "./MostViewed";

const icons = { Headphones, BookOpen, Lamp, Shirt, Bike, Package };
function SignIn({ config, onLogin }) {
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (challenge) {
        const result = await api("/auth/verify", {
          method: "POST",
          body: { challengeId: challenge.challengeId, code },
        });
        onLogin(result.user);
      } else
        setChallenge(
          await api("/auth/request", { method: "POST", body: { email, name } }),
        );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="signin-layout">
      <section className="signin-story">
        <span className="eyebrow">YOUR CAMPUS MARKETPLACE</span>
        <h1>
          Big finds.
          <br />
          Small prices.
        </h1>
        <p>
          Books, tech and everyday essentials.
          <br />
          Buy and sell with people on your campus.
        </p>
        <div className="story-tags">
          <span>
            <BookOpen size={19} /> A semester of stories
          </span>
          <span>
            <Lamp size={19} /> A brighter study corner
          </span>
          <span>
            <Headphones size={19} /> Your next favourite find
          </span>
        </div>
        <div className="story-bottom">
          <span className="large-mark">?</span>
          <p>
            Your everyday finds.
            <br />
            <strong>People on your campus.</strong>
          </p>
        </div>
      </section>
      <section className="signin-card">
        <span className="small-icon">
          <ShieldCheck />
        </span>
        <h2>Your campus. Your people.</h2>
        <p>Sign in with your university email to explore the marketplace.</p>
        <div className="campus-badge">
          <MapPin size={16} />
          {config.university} · Sonipat
        </div>
        {config.googleOnly ? <GoogleSignIn clientId={config.googleClientId} onLogin={onLogin} /> : <form onSubmit={submit}>
          {!challenge ? (
            <>
              <label>
                Your name
                <input
                  required
                  minLength={2}
                  maxLength={60}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="How should we call you?"
                />
              </label>
              <label>
                University email
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={`you@${config.domain}`}
                />
              </label>
              <small>Use {(config.domains || [config.domain]).map(domain => `@${domain}`).join(" or ")}.</small>
            </>
          ) : (
            <>
              <label>
                Six-digit code
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="otp"
                />
              </label>
              <small>For {email}. Codes expire after 10 minutes.</small>
              {challenge.devCode && (
                <div className="test-code">
                  <strong>Local test mode</strong>
                  <span>
                    No email was sent. Your test code is{" "}
                    <b>{challenge.devCode}</b>.
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setCode(challenge.devCode)}
                  >
                    Use test code
                  </button>
                </div>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy
              ? "Please wait…"
              : challenge
                ? "Enter the marketplace"
                : "Continue with email"}
            <ArrowRight size={18} />
          </button>
          {challenge && (
            <button
              type="button"
              className="text-button full"
              onClick={() => {
                setChallenge(null);
                setCode("");
                setError("");
              }}
            >
              Change email or request another code
            </button>
          )}
        </form>}
        <p className="signin-note">
          <ShieldCheck size={17} /> Campus access. No public phone numbers.
        </p>
      </section>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null),
    [user, setUser] = useState(null),
    [bootError, setBootError] = useState(""),
    [ready, setReady] = useState(false);
  const [view, setView] = useState("browse"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [sort, setSort] = useState("recommended"),
    [condition, setCondition] = useState(""),
    [maxPrice, setMaxPrice] = useState(""),
    [filters, setFilters] = useState(false);
  const [items, setItems] = useState([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [hasMore, setHasMore] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [conversationId, setConversationId] = useState(null);
  const [savingEmailPreference, setSavingEmailPreference] = useState(false);
  const applyEmailLink = useCallback((currentUser) => {
    if (!currentUser?.id) return;
    const url = new URL(window.location.href);
    const conversation = url.searchParams.get("conversation");
    if (conversation && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversation)) {
      setConversationId(conversation);
      setView("inbox");
      url.searchParams.delete("conversation");
      window.history.replaceState(null, "", url);
    }
    if (url.searchParams.get("account") === "1") {
      setModal({ type: "account" });
      url.searchParams.delete("account");
      window.history.replaceState(null, "", url);
    }
  }, []);
  const grid = useListingActivity(items, user?.id, loading, !!modal);
  const close = useCallback(() => setModal(null), []);
  const notify = useCallback((message) => setToast(message), []);
  const reload = () => setRefresh((n) => n + 1);
  useEffect(() => {
    let active = true;
    const refreshOnReturn = () => {
      if (document.hidden) return;
      api("/me").then(({ user: current }) => {
        if (!active) return;
        if (current?.id !== user?.id) {
          setUser(current); setView("browse"); setItems([]); setTotal(0);
          setHasMore(false); setPage(1); setQuery(""); setCategory("");
          setCondition(""); setMaxPrice(""); setModal(null); setConversationId(null);
        }
        setRefresh(n => n + 1);
      }).catch(() => {});
    };
    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, [user?.id]);
  useEffect(() => {
    Promise.all([api("/config"), api("/me")])
      .then(([c, m]) => {
        setConfig(c);
        setUser(m.user);
        applyEmailLink(m.user);
        setReady(true);
      })
      .catch((e) => setBootError(e.message));
  }, [applyEmailLink]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user || ["inbox", "admin"].includes(view)) return;
    let ignore = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        view,
        q: query,
        sort,
        page: String(page),
      });
      if (category) params.set("category", category);
      if (condition) params.set("condition", condition);
      if (maxPrice !== "") params.set("maxPrice", maxPrice);
      api(`/listings?${params}`)
        .then((data) => {
          if (!ignore) {
            setItems(data.items);
            setTotal(data.total);
            setHasMore(data.hasMore);
          }
        })
        .catch((e) => {
          if (!ignore) setError(e.message);
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, 180);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [user, view, query, category, sort, condition, maxPrice, page, refresh]);
  function navigate(next) {
    setRefresh(n => n + 1);
    setView(next);
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setLoading(true);
    setFilters(false);
    setPage(1);
    setCategory("");
    setQuery("");
    setCondition("");
    setMaxPrice("");
    setModal(null);
  }
  async function favorite(item) {
    try {
      const result = await api(`/listings/${item.id}/favorite`, {
        method: "PUT",
        body: { saved: !item.saved },
      });
      setItems((list) =>
        list.map((i) => (i.id === item.id ? { ...i, saved: result.saved } : i)),
      );
      if (view === "saved") reload();
      notify(result.saved ? "Saved for later" : "Removed from saved items");
    } catch (e) {
      notify(e.message);
    }
  }
  if (bootError)
    return (
      <div className="loading-page">
        <AlertCircle />
        <h2>We couldn’t reach the marketplace.</h2>
        <p>{bootError}</p>
        <button className="primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  if (!ready)
    return (
      <div className="loading-page">
        <div className="brand-mark" aria-label="Final Price?">?</div>
        <p>Opening your campus marketplace…</p>
      </div>
    );
  return (
    <>
      <div className="campus-strip"><span>GOOD FINDS. PEOPLE YOU KNOW.</span><span>{config.university}</span></div>
      <header className="site-header">
        <button
          className="brand"
          onClick={() => navigate("browse")}
          aria-label="Final Price? home"
        >
          <span>
            Final Price<span className="wordmark-question">?</span>
            <small>THE CAMPUS MARKETPLACE</small>
          </span>
        </button>
        {user ? (
          <>
            <nav aria-label="Main navigation">
              <button
                className={view === "browse" ? "selected" : ""}
                onClick={() => navigate("browse")}
              >
                Explore
              </button>
              <button
                className={view === "mine" ? "selected" : ""}
                onClick={() => navigate("mine")}
              >
                My listings
              </button>
              <button
                className={view === "saved" ? "selected" : ""}
                onClick={() => navigate("saved")}
              >
                <Heart size={18} />
                Saved
              </button>
              <button
                className={view === "inbox" ? "selected" : ""}
                onClick={() => navigate("inbox")}
              >
                <MessageCircle size={18} />
                Messages
              </button>
              {user.isAdmin && (
                <button onClick={() => navigate("admin")}>Reports</button>
              )}
            </nav>
            <div className="header-actions">
              <button
                className="primary sell-button"
                onClick={() => setModal({ type: "create" })}
              >
                <Plus size={18} />
                Sell an item
              </button>
              <button
                className="avatar"
                title={`${user.name} — account`}
                aria-label="Your account"
                onClick={() => setModal({ type: "account" })}
              >
                {user.name[0].toUpperCase()}
              </button>
            </div>
          </>
        ) : (
          <span className="header-campus">
            <MapPin size={16} />
            {config.university}
          </span>
        )}
      </header>
      {config.devAuth && (
        <div className="dev-banner">
          LOCAL PREVIEW{" "}
          <span>Test sign-in is enabled. Sample listings are labelled.</span>
        </div>
      )}
      {!user ? (
        <SignIn config={config} onLogin={(nextUser) => { navigate("browse"); setSort("recommended"); setConversationId(null); setUser(nextUser); applyEmailLink(nextUser); }} />
      ) : (
        <main className="workspace">
          {view === "inbox" ? (
            <Inbox
              key={`${user.id}-${conversationId || "inbox"}`}
              user={user}
              conversationId={conversationId}
              setConversationId={setConversationId}
              notify={notify}
              report={(id) => setModal({ type: "report", conversationId: id })}
            />
          ) : view === "admin" ? (
            <Admin notify={notify} />
          ) : (
            <>
              {view === "browse" ? (
                <section className="campus-hero" aria-label="Your campus marketplace">
                  <div className="hero-copy">
                    <div className="eyebrow">YOUR CAMPUS. YOUR PEOPLE.</div>
                    <h1>Big finds.<br /><span>Small prices.</span></h1>
                    <p>Your next favourite find could be a few doors away.</p>
                    <a href="#campus-listings">Find your next thing <ArrowUpRight size={18} /></a>
                  </div>
                  <MostViewed key={user.id} userId={user.id} refresh={refresh}
                    modalOpen={!!modal} onOpen={id => setModal({ type: "detail", id })}
                    onCreate={() => setModal({ type: "create" })} />
                </section>
              ) : (
                <div className="page-heading"><div>
                  <div className="eyebrow"><MapPin size={14} /> {user.university}</div>
                  <h1>{view === "mine" ? "Your listings, all in one place." : "Good finds, kept close."}</h1>
                  <p>{view === "mine" ? "Manage your listings and let buyers know what’s available." : "A little collection of things you’ve got your eye on."}</p>
                </div></div>
              )}
              <div className="search-row" id="campus-listings">
                <div className="search-box">
                  <Search size={21} />
                  <input
                    aria-label="Search listings"
                    placeholder="Try ‘headphones’, ‘books’ or ‘study lamp’"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                  />
                  {query && (
                    <button
                      className="icon-button"
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
                <button
                  className={`filter-button ${filters ? "active" : ""}`}
                  onClick={() => setFilters(!filters)}
                >
                  <SlidersHorizontal size={18} />
                  Filters
                  {(condition || maxPrice) && <span className="filter-dot" />}
                </button>
              </div>
              {filters && (
                <div className="filter-panel">
                  <label>
                    Condition
                    <select
                      value={condition}
                      onChange={(e) => {
                        setCondition(e.target.value);
                        setPage(1);
                      }}
                    >
                      <option value="">Any condition</option>
                      {config.conditions.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Maximum price (₹)
                    <input
                      type="number"
                      min="0"
                      placeholder="No limit"
                      value={maxPrice}
                      onChange={(e) => {
                        setMaxPrice(e.target.value);
                        setPage(1);
                      }}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => {
                      setCondition("");
                      setMaxPrice("");
                      setCategory("");
                      setQuery("");
                      setPage(1);
                    }}
                  >
                    Reset filters
                  </button>
                </div>
              )}
              <div className="category-row">
                <button
                  className={!category ? "active" : ""}
                  onClick={() => {
                    setCategory("");
                    setPage(1);
                  }}
                >
                  <Store size={19} />
                  All finds
                </button>
                {config.categories.map((c) => {
                  const Icon = icons[c.icon];
                  return (
                    <button
                      key={c.id}
                      className={category === c.id ? "active" : ""}
                      onClick={() => {
                        setCategory(c.id);
                        setPage(1);
                      }}
                    >
                      <Icon size={19} />
                      {c.id}
                    </button>
                  );
                })}
              </div>
              <div className="results-heading">
                <h2 className={view === "browse" && !query && !category ? "sr-only" : ""}>
                  {query
                    ? `Results for “${query}”`
                    : category ||
                      {
                        browse: "Campus listings",
                        mine: "My listings",
                        saved: "Saved items",
                      }[view]}{" "}
                  <span>{total}</span>
                </h2>
                <label className="sort-label">
                  Sort by{" "}
                  <select
                    aria-label="Sort listings"
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="recommended">Recommended</option>
                    <option value="popular">Popular on campus</option>
                    <option value="newest">Newest first</option>
                    <option value="price-low">Price: low to high</option>
                    <option value="price-high">Price: high to low</option>
                  </select>
                </label>
              </div>
              <div className="feed-context">
                {view === "mine" && <p>Sold and unavailable items are hidden from Explore.</p>}
                <button className="text-button" onClick={reload} disabled={loading}><RefreshCw size={15} /> Refresh</button>
              </div>
              {error ? (
                <div className="empty">
                  <AlertCircle />
                  <h2>Couldn’t load listings</h2>
                  <p>{error}</p>
                  <button className="primary" onClick={reload}>
                    Try again
                  </button>
                </div>
              ) : loading ? (
                <div className="listing-grid" aria-label="Loading listings">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="skeleton-card" />
                  ))}
                </div>
              ) : items.length ? (
                <div className="listing-grid" ref={grid}>
                  {items.map((item, index) => (
                    <article className="listing-card" key={item.id} data-listing-id={item.id} data-count-impression={!item.isOwner && !item.is_demo && item.status === "active"} style={{ "--reveal-delay": `${Math.min(index % 4, 3) * 55}ms` }}>
                      <div className="card-image">
                        <button
                          className="image-link"
                          onClick={() =>
                            setModal({ type: "detail", id: item.id })
                          }
                          aria-label={`View ${item.title}`}
                        >
                          <img
                            src={item.images[0]?.url}
                            alt={item.title}
                            loading="lazy"
                          />
                        </button>
                        <span
                          className={`condition ${item.status !== "active" ? "status" : ""}`}
                        >
                          {item.status === "active"
                            ? item.condition
                            : item.status}
                        </span>
                        <button
                          className={`save-button ${item.saved ? "saved" : ""}`}
                          aria-label={`${item.saved ? "Unsave" : "Save"} ${item.title}`}
                          onClick={() => favorite(item)}
                        >
                          <Heart
                            size={19}
                            fill={item.saved ? "currentColor" : "none"}
                          />
                        </button>
                        {item.is_demo && (
                          <span className="demo-label">SAMPLE LISTING</span>
                        )}
                      </div>
                      <div className="card-body">
                        <div className="card-price">
                          {money(item.price)}
                          <span>{item.category}</span>
                        </div>
                        <button
                          className="card-title"
                          onClick={() =>
                            setModal({ type: "detail", id: item.id })
                          }
                        >
                          {item.title}
                        </button>
                        <div className="card-meta">
                          <span>
                            <MapPin size={13} />
                            {item.location}
                          </span>
                          <span>
                            {item.isOwner ? "Your listing" : item.seller_name}
                          </span>
                        </div>
                        {item.isOwner && item.status === "unavailable" && <button className="restore-listing" onClick={async () => {
                          try { await api(`/listings/${item.id}/status`, { method: "PATCH", body: { status: "active", version: item.version } }); reload(); notify("Available again — all courses can now find this item."); }
                          catch (e) { notify(e.message); }
                        }}>Make visible on campus <ArrowUpRight size={15} /></button>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <Package size={38} />
                  <h2>
                    {view === "mine"
                      ? "Your first listing starts here."
                      : view === "saved"
                        ? "Keep your favourite finds here."
                        : "No finds just yet."}
                  </h2>
                  <p>
                    {view === "mine"
                      ? "Snap a photo and find a new home for something you no longer use."
                      : "Try another category or clear your filters."}
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      view === "mine"
                        ? setModal({ type: "create" })
                        : navigate("browse")
                    }
                  >
                    {view === "mine" ? "List an item" : "Explore all finds"}
                  </button>
                </div>
              )}
              {(page > 1 || hasMore) && (
                <div className="pagination">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {page}</span>
                  <button
                    disabled={!hasMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
              <footer>
                <span className="footer-brand">Final Price?</span>
              </footer>
            </>
          )}
        </main>
      )}
      {modal?.type === "account" && (
        <Modal title="Your campus account" onClose={close}>
          <div className="account">
            <span className="avatar large">{user.name[0]}</span>
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            <p>
              {user.university} · {user.campus}
            </p>
            <div className="notice">
              {user.authMethod === "local"
                ? "Local test account — email ownership has not been verified."
                : user.authMethod === "google" ? "Official university Google account verified." : "University email verified."}
            </div>
            {user.emailNotificationsAvailable && <label className="email-preference">
              <input type="checkbox" checked={user.emailNotifications} disabled={savingEmailPreference}
                onChange={async e => {
                  const value = e.target.checked;
                  setSavingEmailPreference(true);
                  try {
                    const result = await api("/me/preferences", { method: "PATCH", body: { emailNotifications: value } });
                    setUser(current => ({ ...current, emailNotifications: result.emailNotifications }));
                    notify(value ? "Message emails enabled" : "Message emails turned off");
                  } catch (error) { notify(error.message); }
                  finally { setSavingEmailPreference(false); }
                }} />
              <span><strong>Email me about new messages</strong><small>Get an email when a buyer messages you about your listing. Messages you read right away won’t trigger an email.</small></span>
            </label>}
            <button
              className="secondary full"
              onClick={async () => {
                try {
                  await api("/auth/logout", { method: "POST" });
                  window.google?.accounts?.id?.disableAutoSelect();
                  setUser(null); setConversationId(null); setSort("recommended"); close(); navigate("browse");
                } catch (e) { notify(e.message); }
              }}
            >
              <LogOut size={17} />
              Sign out
            </button>
          </div>
        </Modal>
      )}
      {(modal?.type === "create" || modal?.type === "edit") && (
        <Modal
          key={modal.type}
          title={
            modal.type === "edit"
              ? "Edit your listing"
              : "List an item"
          }
          wide
          onClose={close}
        >
          <ListingForm
            config={config}
            item={modal.item}
            onSave={(item) => {
              navigate(item.status === "active" ? "browse" : "mine"); setSort("recommended"); reload();
              setModal({ type: "detail", id: item.id });
              notify(item.status === "active" ? "Published — students across all approved courses can see your listing." : "Updated. Make this item available to show it in Explore.");
            }}
          />
        </Modal>
      )}
      {modal?.type === "detail" && (
        <Modal key={`detail-${modal.id}`} title="A closer look" wide onClose={() => { close(); reload(); }}>
          <ListingDetail
            id={modal.id}
            notify={notify}
            favorite={favorite}
            onEdit={(item) => setModal({ type: "edit", item })}
            onStatus={() => {
              reload();
              close();
              notify("Listing updated");
            }}
            onReport={(id) => setModal({ type: "report", listingId: id })}
            onChat={(id) => {
              setConversationId(id);
              navigate("inbox");
            }}
          />
        </Modal>
      )}
      {modal?.type === "report" && (
        <Modal title="Help keep campus safe" onClose={close}>
          <ReportForm
            target={modal}
            onDone={() => {
              close();
              notify(
                "Report submitted. Thank you for looking out for your campus.",
              );
            }}
          />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
    </>
  );
}
