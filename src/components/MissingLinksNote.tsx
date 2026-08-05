interface Missing {
  github: boolean;
  linkedin: boolean;
}

/**
 * Highlighted note recording that the recruiter was asked for a profile link
 * and confirmed it wasn't available — distinct from simply not having looked.
 */
export default function MissingLinksNote({ missing }: { missing?: Missing | null }) {
  if (!missing || (!missing.github && !missing.linkedin)) return null;
  const both = missing.github && missing.linkedin;
  const which = both ? "GitHub or LinkedIn" : missing.github ? "GitHub" : "LinkedIn";
  return (
    <div className="alert warn" style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
      <span aria-hidden="true">⚠</span>
      <span>
        <strong>No {which} profile provided.</strong> The resume didn&#39;t contain{" "}
        {both ? "either link" : "this link"} and the recruiter confirmed{" "}
        {both ? "neither was" : "it was"} available, so{" "}
        {missing.github ? "the portfolio assessment could not run" : "the credibility check could not run"}
        {both ? " and no credibility check was possible" : ""}.
      </span>
    </div>
  );
}
