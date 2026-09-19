import { describe, it, expect } from "vitest";
import { blankFields, emailJsConfigured, EMPTY_EMAILJS, EmailJsSettings } from "./emailjsSettings";

const full: EmailJsSettings = {
  serviceId: "service_ahvswrk",
  templateId: "template_abc123",
  publicKey: "pub_key",
  privateKey: "priv_key",
};

describe("blankFields", () => {
  it("reports nothing missing when all four are set", () => {
    expect(blankFields(full)).toEqual([]);
  });

  it("reports all four on an empty config", () => {
    expect(blankFields(EMPTY_EMAILJS)).toEqual([
      "serviceId",
      "templateId",
      "publicKey",
      "privateKey",
    ]);
  });

  it("names the one that is missing", () => {
    expect(blankFields({ ...full, privateKey: "" })).toEqual(["privateKey"]);
  });

  // The private key is the field people skip, because EmailJS's own browser
  // examples do not use it — so whitespace in it must not read as "set".
  it("treats whitespace as blank", () => {
    expect(blankFields({ ...full, privateKey: "   " })).toEqual(["privateKey"]);
  });
});

describe("emailJsConfigured", () => {
  it("is true only when nothing is blank", () => {
    expect(emailJsConfigured(full)).toBe(true);
    expect(emailJsConfigured({ ...full, templateId: "" })).toBe(false);
    expect(emailJsConfigured(EMPTY_EMAILJS)).toBe(false);
  });
});
