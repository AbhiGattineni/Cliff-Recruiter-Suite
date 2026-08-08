import { useState } from "react";
import { useNavigate } from "react-router-dom";

// The dashboard is the ask bar and nothing else — as close to google.com's
// homepage as this app gets. Everything that used to live here (stat cards,
// fit breakdown, LLM usage, the tool grid) is one click away in the sidebar;
// putting it all on the landing page just delayed getting to the one thing
// most visits are actually for.
export default function Home() {
  const navigate = useNavigate();
  const [ask, setAsk] = useState("");

  return (
    <div className="home-center">
      <div className="home-mark">Cliff Recruiter Suite</div>
      <p className="muted home-tagline">Ask anything about your submissions, requirements, recruiters or clients.</p>

      <form
        className="ask-bar home-ask-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const q = ask.trim();
          navigate(q ? `/ask?q=${encodeURIComponent(q)}` : "/ask");
        }}
      >
        <input
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="e.g. submissions by status this week"
          aria-label="Ask anything about your data"
          autoFocus
        />
        <button className="btn" type="submit">🔎 Ask</button>
      </form>
    </div>
  );
}
