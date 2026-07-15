import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUseAI, setUseAI } from "../lib/preferences";
import { getLlmUsageSummary } from "../lib/resume";
import LlmUsagePanel from "../components/LlmUsagePanel";

export default function Preferences() {
  const [useAI, setUse] = useState(getUseAI());
  const usageQ = useQuery({ queryKey: ["llmUsageSummary"], queryFn: () => getLlmUsageSummary() });

  const toggle = () => {
    const next = !useAI;
    setUse(next);
    setUseAI(next);
  };

  return (
    <div>
      <h1>Preferences</h1>
      <p className="muted" style={{ marginTop: "-0.25rem" }}>Feature toggles for the suite.</p>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ fontWeight: 600 }}>Use AI (LLM) features</div>
            <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
              When <strong>on</strong>, the Candidate Pool uses AI semantic role matching (best quality; each
              search is one LLM call). When <strong>off</strong>, it falls back to free keyword matching —
              no LLM cost. Turn this off to restrict token usage when AI isn&#39;t needed.
            </div>
          </div>
          <label className="switch" title="Toggle AI features">
            <input type="checkbox" checked={useAI} onChange={toggle} />
            <span className="slider" />
          </label>
        </div>
        <p className="muted" style={{ fontSize: "0.82rem", margin: "0.75rem 0 0" }}>
          AI is currently <strong>{useAI ? "ON" : "OFF"}</strong>. This setting is saved on this device.
        </p>
      </div>

      <LlmUsagePanel summary={usageQ.data} />
    </div>
  );
}
