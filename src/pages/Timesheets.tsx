// Placeholder for the Timesheets tool. The nav entry and route exist so the
// feature has a home; the actual implementation comes later.

export default function Timesheets() {
  return (
    <div>
      <h1>Timesheets</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>
        Consultant timesheet tracking — not built yet.
      </p>

      <div className="card">
        <div style={{ textAlign: "center", padding: "2.5rem 1rem" }}>
          <div style={{ fontSize: "2.5rem", lineHeight: 1 }} aria-hidden="true">⏱️</div>
          {/* A plain div, not an h2 — `.card h2` is display:flex globally, which
              defeats the centring on this card. */}
          <div style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0.75rem 0 0.35rem" }}>Coming soon</div>
          <p className="muted" style={{ maxWidth: 520, margin: "0 auto" }}>
            This tab is a placeholder. Nothing is stored or calculated here yet — the page exists so the
            feature has a place to land once we decide what it should do.
          </p>
        </div>
      </div>
    </div>
  );
}
