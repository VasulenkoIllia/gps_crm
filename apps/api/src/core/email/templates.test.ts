import { describe, expect, it } from "vitest";
import { invitationLetter, passwordResetLetter } from "./templates.js";

const LINK = "https://app.example.test/invite#token=abc";

describe("letters", () => {
  it("carry the link in both parts", () => {
    const letter = invitationLetter("a@b.co", "Олена", LINK);
    expect(letter.text).toContain(LINK);
    expect(letter.html).toContain(LINK);
    expect(passwordResetLetter("a@b.co", LINK).text).toContain(LINK);
  });

  it("escape a name that holds markup", () => {
    const { html } = invitationLetter("a@b.co", '<img src=x onerror="alert(1)">', LINK);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("use no long dashes", () => {
    const letter = invitationLetter("a@b.co", "Олена", LINK);
    expect(`${letter.subject}${letter.text}`).not.toMatch(/[–—]/);
  });
});
