import { useState, useEffect, useRef } from "react";
import { preparePhoto } from "./preparePhoto";
import {
  MapPin,
  MessageCircle,
  Heart,
  Flag,
  Upload,
  X,
  ArrowLeft,
  ArrowRight,
  Send,
  ShieldCheck,
  Trash2,
  Pencil,
  Check,
  Ban,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, money } from "./api";
import Modal from "./Modal";

function PhotoViewer({ images, title, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(false);
  function move(step) { setIndex(i => (i + step + images.length) % images.length); setZoom(false); }
  return <Modal title={title} onClose={onClose} photo>
    <div className="photo-viewer" onKeyDown={e => {
      if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
    }}>
      <div className={`photo-stage ${zoom ? "zoomed" : ""}`}>
        <button onClick={() => setZoom(v => !v)} aria-label={zoom ? "Zoom out of photo" : "Zoom into photo"}>
          <img key={images[index].id} src={images[index].url} alt={`${title}, photo ${index + 1}`} />
        </button>
      </div>
      <div className="photo-controls">
        <button className="icon-button" disabled={images.length < 2} onClick={() => move(-1)} aria-label="Previous photo"><ArrowLeft /></button>
        <span aria-live="polite">{index + 1} / {images.length}</span>
        <button className="icon-button" onClick={() => setZoom(v => !v)} aria-label={zoom ? "Zoom out" : "Zoom in"}>{zoom ? <ZoomOut /> : <ZoomIn />}</button>
        <button className="icon-button" disabled={images.length < 2} onClick={() => move(1)} aria-label="Next photo"><ArrowRight /></button>
      </div>
    </div>
  </Modal>;
}

export function ListingDetail({
  id,
  onEdit,
  onStatus,
  onReport,
  onChat,
  notify,
}) {
  const [item, setItem] = useState(null),
    [error, setError] = useState(""),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const soldButton = useRef(null);
  const cancelSaleButton = useRef(null);
  useEffect(() => {
    if (confirm !== "sold") return;
    cancelSaleButton.current?.focus({ preventScroll: true });
    // Keep both choices visible even when the original button is near the
    // bottom of the dialog's viewport. No manual scrolling is needed.
    cancelSaleButton.current?.parentElement.scrollIntoView({ block: "nearest" });
  }, [confirm]);
  useEffect(() => {
    let alive = true;
    api(`/listings/${id}`)
      .then((v) => {
        if (alive) {
          setItem(v);
          // Count deliberate detail opens, never carousel rotations or card visibility.
          api(`/listings/${id}/open`, { method: "POST" }).catch(() => {});
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  async function changeStatus(status) {
    setBusy(true);
    try {
      await api(`/listings/${id}/status`, {
        method: "PATCH",
        body: { status, version: item.version },
      });
      onStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function chat() {
    setBusy(true);
    try {
      const c = await api(`/listings/${id}/conversations`, { method: "POST" });
      onChat(c.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    try {
      const result = await api(`/listings/${id}/favorite`, {
        method: "PUT",
        body: { saved: !item.saved },
      });
      setItem({ ...item, saved: result.saved });
      notify(result.saved ? "Saved for later" : "Removed from saved items");
    } catch (e) {
      setError(e.message);
    }
  }
  if (!item)
    return (
      <p className={error ? "error" : "notice"}>
        {error || "Loading listing…"}
      </p>
    );
  return (
    <>
      <div className="detail-grid">
        <div>
          <div className="detail-image">
            <button className="detail-photo-button" onClick={() => setPhotoOpen(true)} aria-label={`Enlarge photo of ${item.title}`}>
              <img key={item.images[index]?.id} src={item.images[index]?.url} alt={item.title} />
              <span><ZoomIn size={16} /> Take a closer look</span>
            </button>
            {item.is_demo && <span className="demo-label">SAMPLE LISTING</span>}
          </div>
          <div className="thumbnails">
            {item.images.map((image, i) => (
              <button
                key={image.id}
                aria-label={`View photo ${i + 1}`}
                className={index === i ? "active" : ""}
                onClick={() => setIndex(i)}
              >
                <img src={image.url} alt={`Photo ${i + 1}`} />
              </button>
            ))}
          </div>
        </div>
        <div className="detail-info">
          <span className="detail-category">
            {item.category} / {item.condition}
          </span>
          <h2>{item.title}</h2>
          <div className="detail-price">{money(item.price)}</div>
          <span className={`status-pill ${item.status}`}>
            {item.status === "active" ? "Available on campus" : item.status}
          </span>
          {item.isOwner && <p className={`visibility-note ${item.status === "active" ? "visible" : ""}`}>
            {item.status === "active" ? "Visible to students across all approved courses." : item.status === "unavailable" ? "Hidden from Explore. Make it available again below so other students can find it." : "Sold items are hidden from Explore. Your conversation history is still available."}
          </p>}
          <p className="location">
            <MapPin size={16} />
            {item.location} · Sonipat
          </p>
          <div className="seller-box">
            <span className="avatar">{item.seller_name[0]}</span>
            <div>
              <strong>{item.seller_name}</strong>
              <small>{item.is_demo ? "Sample seller" : item.university}</small>
            </div>
          </div>
          {item.isOwner ? (
            <div className="detail-actions">
              {item.status !== "sold" && (
                <>
                  <button className="primary" onClick={() => onEdit(item)}>
                    <Pencil size={16} />
                    Edit listing
                  </button>
                  {confirm === "sold" ? (
                    <div className="confirm-box sale-confirmation" role="group" aria-labelledby="sale-confirmation-title">
                      <strong id="sale-confirmation-title">Mark this item as sold?</strong>
                      <div>
                        <button
                          ref={cancelSaleButton}
                          className="secondary"
                          disabled={busy}
                          onClick={() => {
                            setConfirm("");
                            setError("");
                            requestAnimationFrame(() => soldButton.current?.focus({ preventScroll: true }));
                          }}
                        >
                          Cancel
                        </button>
                        <button className="primary" disabled={busy} onClick={() => changeStatus("sold")}>
                          {busy ? "Updating…" : "Yes, mark as sold"}
                        </button>
                      </div>
                      <p>It will leave Explore. Existing conversations will stay available.</p>
                      {error && <p className="error" role="alert">{error}</p>}
                    </div>
                  ) : (
                    <button
                      ref={soldButton}
                      className="secondary"
                      disabled={busy}
                      onClick={() => { setError(""); setConfirm("sold"); }}
                    >
                      <Check size={16} />
                      Mark as sold
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => item.status === "unavailable" ? changeStatus("active") : setConfirm("unavailable")}
                  >
                    {item.status === "unavailable"
                      ? "Make available again"
                      : "Mark unavailable"}
                  </button>
                </>
              )}
              <button
                className="danger-link"
                onClick={() => setConfirm("deleted")}
              >
                <Trash2 size={15} />
                Delete listing
              </button>
            </div>
          ) : (
            <div className="detail-actions">
              <button
                className="primary full"
                disabled={busy || item.status !== "active" || item.is_demo}
                onClick={chat}
              >
                <MessageCircle size={18} />
                {item.is_demo
                  ? "Sample listing — chat unavailable"
                  : item.status === "active"
                    ? "Chat with seller"
                    : "Item no longer available"}
              </button>
              <button className="secondary full" onClick={save}>
                <Heart size={17} fill={item.saved ? "currentColor" : "none"} />
                {item.saved ? "Saved to your finds" : "Save for later"}
              </button>
            </div>
          )}
          <p className="safety-note">
            <ShieldCheck size={17} />
            Meet in a public campus spot. Inspect the item and pay the seller
            directly.
          </p>
        </div>
      </div>
      {photoOpen && <PhotoViewer images={item.images} title={item.title} initialIndex={index} onClose={() => setPhotoOpen(false)} />}
      <div className="description">
        <h3>About this find</h3>
        <p>{item.description}</p>
        {Object.entries(item.attributes).length > 0 && (
          <dl>
            {Object.entries(item.attributes).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value || "Not specified"}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="detail-bottom">
          <small>
            Listed {new Date(item.created_at).toLocaleDateString("en-IN")}
          </small>
          <button className="text-button" onClick={() => onReport(id)}>
            <Flag size={14} />
            Report listing
          </button>
        </div>
      </div>
      {confirm && confirm !== "sold" && (
        <div className="confirm-box">
          <strong>
            {confirm === "unavailable" ? "Hide this item from Explore?"
              : "Delete this listing?"}
          </strong>
          <p>
            {confirm === "unavailable" ? "Other students will no longer find it in Explore. You can make it available again from My listings."
              : "It will disappear from discovery. Conversation history will be kept."}
          </p>
          <div>
            <button className="secondary" onClick={() => setConfirm("")}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => changeStatus(confirm)}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
      {error && confirm !== "sold" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function ListingForm({ config, item, onSave }) {
  const [form, setForm] = useState({
    title: item?.title || "",
    description: item?.description || "",
    category: item?.category || "Electronics",
    price: item ? String(item.price / 100) : "",
    condition: item?.condition || "Good",
    location: item?.location || "",
    attributes: item?.attributes || {},
  });
  const [images, setImages] = useState(item?.images || []),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  const change = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  async function upload(event) {
    const files = Array.from(event.target.files);
    event.target.value = "";
    if (images.length + files.length > 6) {
      setError("Add up to six photos.");
      return;
    }
    setUploading(true);
    setError("");
    for (const file of files) {
      try {
        const data = new FormData();
        data.append("photo", await preparePhoto(file));
        const image = await api("/images", { method: "POST", body: data });
        setImages((current) => [...current, image]);
      } catch (e) {
        setError(e.message);
      }
    }
    setUploading(false);
  }
  async function remove(image) {
    if (!item?.images.some((i) => i.id === image.id)) {
      try {
        await api(`/images/${image.id}`, { method: "DELETE" });
      } catch (e) {
        setError(e.message);
        return;
      }
    }
    setImages((current) => current.filter((i) => i.id !== image.id));
  }
  function reorder(index, direction) {
    setImages((current) => {
      const copy = [...current];
      [copy[index], copy[index + direction]] = [
        copy[index + direction],
        copy[index],
      ];
      return copy;
    });
  }
  async function submit(e) {
    e.preventDefault();
    if (!images.length) {
      setError("Add at least one photo.");
      return;
    }
    if (!preview) {
      setPreview(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api(item ? `/listings/${item.id}` : "/listings", {
        method: item ? "PATCH" : "POST",
        body: {
          ...form,
          price: Math.round(Number(form.price) * 100),
          imageIds: images.map((i) => i.id),
          ...(item ? { version: item.version } : {}),
        },
      });
      onSave(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="listing-form" onSubmit={submit}>
      {preview ? (
        <>
          <div className="notice">
            Ready for its next home? Check your listing before publishing.
          </div>
          <div className="preview-listing">
            <img src={images[0]?.url} alt={form.title} />
            <div>
              <small>
                {form.category} · {form.condition}
              </small>
              <h2>{form.title}</h2>
              <h3>{money(Math.round(Number(form.price) * 100))}</h3>
              <p>{form.description}</p>
              <span>
                <MapPin size={15} />
                {form.location}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="form-intro">
            A few details, a good photo, and you’re on your way.
          </p>
          <div className="form-grid">
            <label className="span-two">
              What are you selling?
              <input
                required
                minLength={3}
                maxLength={120}
                placeholder="e.g. Adjustable study lamp"
                value={form.title}
                onChange={(e) => change("title", e.target.value)}
              />
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target.value,
                    attributes: {},
                  }))
                }
              >
                {config.categories.map((c) => (
                  <option key={c.id}>{c.id}</option>
                ))}
              </select>
            </label>
            <label>
              Condition
              <select
                value={form.condition}
                onChange={(e) => change("condition", e.target.value)}
              >
                {config.conditions.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Price (₹)
              <input
                type="number"
                required
                min="0"
                max="1000000"
                step="0.01"
                placeholder="0 for a free item"
                value={form.price}
                onChange={(e) => change("price", e.target.value)}
              />
            </label>
            <label>
              Campus pickup spot
              <input
                required
                minLength={2}
                maxLength={80}
                placeholder="e.g. Library entrance"
                value={form.location}
                onChange={(e) => change("location", e.target.value)}
              />
            </label>
            {config.categories
              .find((c) => c.id === form.category)
              .fields.map((field) => (
                <label key={field}>
                  {field} <span className="optional">optional</span>
                  <input
                    maxLength={100}
                    value={form.attributes[field] || ""}
                    onChange={(e) =>
                      change("attributes", {
                        ...form.attributes,
                        [field]: e.target.value,
                      })
                    }
                  />
                </label>
              ))}
            <label className="span-two">
              Tell buyers a little more
              <textarea
                required
                minLength={10}
                maxLength={4000}
                placeholder="What’s included? Any wear or quirks worth mentioning?"
                value={form.description}
                onChange={(e) => change("description", e.target.value)}
              />
            </label>
          </div>
          <div className="upload-heading">
            <h3>Show it off</h3>
            <span>{images.length}/6 photos · first photo is the cover</span>
          </div>
          <div className="upload-grid">
            {images.map((image, i) => (
              <div className="upload-photo" key={image.id}>
                <img src={image.url} alt={`Listing photo ${i + 1}`} />
                <button
                  type="button"
                  className="remove-photo"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => remove(image)}
                >
                  <X size={15} />
                </button>
                <div className="photo-order">
                  <button
                    type="button"
                    disabled={i === 0}
                    aria-label={`Move photo ${i + 1} earlier`}
                    onClick={() => reorder(i, -1)}
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={i === images.length - 1}
                    aria-label={`Move photo ${i + 1} later`}
                    onClick={() => reorder(i, 1)}
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            ))}
            {images.length < 6 && (
              <label className="upload-zone">
                <Upload size={25} />
                <strong>{uploading ? "Uploading…" : "Add photos"}</strong>
                <small>
                  JPEG, PNG or WebP
                  <br />
                  up to 8 MB each
                </small>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={uploading}
                  onChange={upload}
                />
              </label>
            )}
          </div>
          <p className="form-footnote">
            Keep exact room numbers and personal contact details out of your
            listing.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-actions">
        {preview && (
          <button
            type="button"
            className="secondary"
            onClick={() => setPreview(false)}
          >
            Back to edit
          </button>
        )}
        <button className="primary" disabled={busy || uploading}>
          {busy
            ? "Saving…"
            : preview
              ? item
                ? "Save changes"
                : "Publish listing"
              : "Preview listing"}
          <ArrowRight size={17} />
        </button>
      </div>
    </form>
  );
}

export function Inbox({
  user,
  conversationId,
  setConversationId,
  report,
  notify,
}) {
  const [conversations, setConversations] = useState([]),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false),
    [older, setOlder] = useState([]),
    [more, setMore] = useState(false),
    [confirmBlock, setConfirmBlock] = useState(false);
  const end = useRef(null),
    retry = useRef(null),
    lastRead = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api("/conversations")
        .then((v) => {
          if (alive) {
            setConversations(v);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    lastRead.current = 0;
    retry.current = null;
    const load = async () => {
      try {
        const value = await api(`/conversations/${conversationId}/messages`);
        if (!alive) return;
        setData(value);
        setMore(value.hasMore);
        setError("");
        const id = value.messages.at(-1)?.id;
        if (id && id > lastRead.current && !document.hidden) {
          await api(`/conversations/${conversationId}/read`, {
            method: "POST",
            body: { lastId: id },
          });
          lastRead.current = id;
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [conversationId]);
  const lastMessageId = data?.messages.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [lastMessageId]);
  async function send(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    const id = conversationId;
    const pending =
      retry.current?.body === draft.trim()
        ? retry.current
        : { body: draft.trim(), clientId: crypto.randomUUID() };
    retry.current = pending;
    setSending(true);
    try {
      const message = await api(`/conversations/${id}/messages`, {
        method: "POST",
        body: pending,
      });
      setData((value) =>
        value?.conversation.id === id
          ? {
              ...value,
              messages: [
                ...value.messages.filter((m) => m.id !== message.id),
                message,
              ],
            }
          : value,
      );
      setDraft("");
      retry.current = null;
      setError("");
    } catch (e) {
      setError(`${e.message} Your message is kept here; press send to retry.`);
    } finally {
      setSending(false);
    }
  }
  async function loadOlder() {
    try {
      const before = older[0]?.id || data.messages[0]?.id;
      const result = await api(
        `/conversations/${conversationId}/messages?before=${before}`,
      );
      setOlder((previous) => [...result.messages, ...previous]);
      setMore(result.hasMore);
    } catch (e) {
      setError(e.message);
    }
  }
  async function block() {
    try {
      await api(`/conversations/${conversationId}/block`, { method: "POST" });
      setData({ ...data, blocked: true });
      setConfirmBlock(false);
      notify("Student blocked. No more messages can be sent.");
    } catch (e) {
      setError(e.message);
    }
  }
  const messages = [...older, ...(data?.messages || [])].filter(
    (m, i, all) => all.findIndex((n) => n.id === m.id) === i,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GOOD FINDS START WITH A HELLO</div>
          <h1>Your campus conversations.</h1>
          <p>Ask a question. Arrange a pickup. Keep it all here.</p>
        </div>
      </div>
      <div className={`inbox ${conversationId ? "has-conversation" : ""}`}>
        <aside className="conversation-list">
          <h2>
            Messages <span>{conversations.length}</span>
          </h2>
          {!conversations.length ? (
            <div className="inbox-empty">
              <MessageCircle />
              <p>
                Found something you like? Open a listing and say hello to the
                seller.
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                className={conversationId === c.id ? "active" : ""}
                onClick={() => setConversationId(c.id)}
              >
                <span className="avatar">{c.other.name[0]}</span>
                <div>
                  <strong>{c.other.name}</strong>
                  <span>{c.title}</span>
                  <small>{c.lastMessage}</small>
                </div>
                {c.unread > 0 && <b className="unread">{c.unread}</b>}
              </button>
            ))
          )}
        </aside>
        <section className="chat-panel">
          {!conversationId ? (
            <div className="empty-chat">
              <MessageCircle size={40} />
              <h2>A little hello goes a long way.</h2>
              <p>Select a conversation to get started.</p>
            </div>
          ) : !data ? (
            <div className="empty-chat">
              <p>{error || "Opening conversation…"}</p>
              <button
                className="text-button"
                onClick={() => setConversationId(null)}
              >
                Back to messages
              </button>
            </div>
          ) : (
            <>
              <div className="chat-header">
                <button
                  className="mobile-back icon-button"
                  aria-label="Back to inbox"
                  onClick={() => setConversationId(null)}
                >
                  <ArrowLeft />
                </button>
                <div>
                  <strong>{data.other.name}</strong>
                  <span>
                    {data.conversation.title} · {money(data.conversation.price)}
                  </span>
                </div>
                <button
                  className="icon-button"
                  aria-label="Report conversation"
                  onClick={() => report(conversationId)}
                >
                  <Flag size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Block student"
                  onClick={() => setConfirmBlock(true)}
                >
                  <Ban size={18} />
                </button>
              </div>
              {data.conversation.listing_status !== "active" && (
                <div className="chat-notice">
                  Listing {data.conversation.listing_status}. Your conversation
                  history stays here.
                </div>
              )}
              {data.blocked && (
                <div className="chat-notice">
                  This conversation is blocked. Messages can no longer be sent.
                </div>
              )}
              <div className="messages" aria-label="Conversation messages">
                {more && messages.length > 0 && (
                  <button className="text-button full" onClick={loadOlder}>
                    Load earlier messages
                  </button>
                )}
                {messages.length === 0 && (
                  <div className="chat-start">
                    <span className="avatar large">{data.other.name[0]}</span>
                    <h3>Say hello to {data.other.name.split(" ")[0]}.</h3>
                    <p>The seller will only see this conversation after you press Send.</p>
                    <button
                      className="quick-message"
                      onClick={() => setDraft("Hi! Is this still available?")}
                    >
                      Hi! Is this still available?
                    </button>
                  </div>
                )}
                {messages.map((message) => (
                  <div
                    className={`message ${message.sender_id === user.id ? "mine" : ""}`}
                    key={message.id}
                  >
                    <p>{message.body}</p>
                    <small>
                      {new Date(message.created_at).toLocaleTimeString(
                        "en-IN",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </small>
                  </div>
                ))}
                <div ref={end} />
              </div>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              {confirmBlock && (
                <div className="confirm-box">
                  <strong>Block this student?</strong>
                  <p>
                    Neither of you will be able to send messages to the other.
                  </p>
                  <div>
                    <button
                      className="secondary"
                      onClick={() => setConfirmBlock(false)}
                    >
                      Cancel
                    </button>
                    <button className="primary" onClick={block}>
                      Block student
                    </button>
                  </div>
                </div>
              )}
              <form className="composer" onSubmit={send}>
                <input
                  aria-label="Message"
                  placeholder="Write a message…"
                  maxLength={2000}
                  value={draft}
                  disabled={
                    data.blocked ||
                    data.other.status !== "active" ||
                    ["removed", "deleted"].includes(
                      data.conversation.listing_status,
                    )
                  }
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="primary"
                  aria-label="Send message"
                  disabled={sending || !draft.trim() || data.blocked}
                >
                  <Send size={19} />
                </button>
              </form>
              <div className="chat-footer">
                <ShieldCheck size={13} />
                Never pay in advance. Meet and inspect the item first.
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

export function ReportForm({ target, onDone }) {
  const [reason, setReason] = useState("Scam or fake listing"),
    [details, setDetails] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/reports", {
        method: "POST",
        body: {
          listingId: target.listingId,
          conversationId: target.conversationId,
          reason,
          details,
        },
      });
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack-form" onSubmit={submit}>
      <p className="form-intro">
        Tell us what’s wrong. Reports are visible only to the moderation team.
      </p>
      <label>
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {[
            "Scam or fake listing",
            "Prohibited item",
            "Spam",
            "Harassment",
            "Other",
          ].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label>
        Anything else we should know?
        <textarea
          maxLength={2000}
          placeholder="Add context that could help us review this report."
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary full" disabled={busy}>
        {busy ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

export function Admin({ notify }) {
  const [reports, setReports] = useState([]),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [action, setAction] = useState("dismiss"),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api("/admin/reports")
      .then(setReports)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  async function resolve(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/admin/reports/${selected.id}/resolve`, {
        method: "POST",
        body: { action, reason },
      });
      setSelected(null);
      setReason("");
      load();
      notify("Report resolved and action recorded.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAMPUS MODERATION</div>
          <h1>Keep good things going.</h1>
          <p>Review reports and take action with a recorded reason.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {reports.length === 0 ? (
        <div className="empty">
          <ShieldCheck size={35} />
          <h2>All clear.</h2>
          <p>No reports to review.</p>
        </div>
      ) : (
        <div className="report-list">
          {reports.map((r) => (
            <article key={r.id}>
              <span className="status-pill">{r.status}</span>
              <h3>{r.reason}</h3>
              <p>
                {r.title || "Private conversation"} · Reported by{" "}
                {r.reporter_name}
              </p>
              <p>{r.details || "No additional details."}</p>
              {r.status === "open" && (
                <button
                  className="secondary"
                  onClick={() => {
                    setSelected(r);
                    setAction("dismiss");
                  }}
                >
                  Review action
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {selected && (
        <form className="moderation-form stack-form" onSubmit={resolve}>
          <h2>Resolve report</h2>
          <label>
            Action
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="dismiss">Dismiss report</option>
              {selected.listing_id && (
                <option value="remove_listing">Remove listing</option>
              )}
              <option value="suspend_user">Suspend reported user</option>
            </select>
          </label>
          <label>
            Reason for this action
            <textarea
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Confirm action
            </button>
          </div>
        </form>
      )}
    </>
  );
}
