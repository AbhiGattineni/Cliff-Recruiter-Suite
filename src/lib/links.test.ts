import { describe, it, expect } from "vitest";
import { extractProfileLinks, normalizeGithubUrl, normalizeLinkedinUrl } from "./links";

describe("extractProfileLinks", () => {
  it("finds a full GitHub URL", () => {
    const r = extractProfileLinks("Projects: https://github.com/john-doe and more");
    expect(r.github).toBe("https://github.com/john-doe");
  });

  it("finds a bare github.com link without protocol", () => {
    const r = extractProfileLinks("GitHub: github.com/JaneDoe99 | Portfolio: example.com");
    expect(r.github).toBe("https://github.com/JaneDoe99");
  });

  it("ignores reserved GitHub paths", () => {
    const r = extractProfileLinks("see https://github.com/features/actions");
    expect(r.github).toBe("");
  });

  it("takes only the username from a repo URL", () => {
    const r = extractProfileLinks("https://github.com/john-doe/my-project");
    expect(r.github).toBe("https://github.com/john-doe");
  });

  it("finds a LinkedIn profile URL", () => {
    const r = extractProfileLinks("LinkedIn: https://www.linkedin.com/in/jane-doe-123abc/");
    expect(r.linkedin).toBe("https://www.linkedin.com/in/jane-doe-123abc");
  });

  it("normalises a protocol-less LinkedIn URL", () => {
    const r = extractProfileLinks("linkedin.com/in/john.doe");
    expect(r.linkedin).toBe("https://linkedin.com/in/john.doe");
  });

  it("returns empty strings when nothing is present", () => {
    const r = extractProfileLinks("Just a resume with no links at all.");
    expect(r).toEqual({ github: "", linkedin: "" });
  });
});

describe("normalizeGithubUrl", () => {
  it("accepts a bare username", () => {
    expect(normalizeGithubUrl("john-doe")).toBe("https://github.com/john-doe");
  });
  it("accepts a full URL", () => {
    expect(normalizeGithubUrl("https://github.com/john-doe")).toBe("https://github.com/john-doe");
  });
  it("rejects garbage", () => {
    expect(normalizeGithubUrl("not a url!!")).toBe("");
  });
});

describe("normalizeLinkedinUrl", () => {
  it("passes through a valid profile URL", () => {
    expect(normalizeLinkedinUrl("https://linkedin.com/in/jane")).toBe("https://linkedin.com/in/jane");
  });
  it("rejects non-LinkedIn input", () => {
    expect(normalizeLinkedinUrl("https://example.com/in/jane")).toBe("");
  });
});
