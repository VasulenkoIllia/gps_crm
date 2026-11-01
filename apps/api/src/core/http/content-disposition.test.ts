import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition.js";

describe("Content-Disposition", () => {
  it("keeps a plain name as it is", () => {
    expect(contentDisposition("inline", "scan 1.pdf")).toBe(
      `inline; filename="scan 1.pdf"; filename*=UTF-8''scan%201.pdf`,
    );
  });

  it("gives old clients a stand-in and the rest the real name", () => {
    expect(contentDisposition("attachment", "договір.pdf")).toBe(
      `attachment; filename="_______.pdf"; filename*=UTF-8''%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D1%96%D1%80.pdf`,
    );
  });

  it("does not let a name out of its quotes or out of the header", () => {
    const header = contentDisposition("attachment", 'a"b\\c\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain(`filename="a_b_c__Set-Cookie: x=1.pdf"`);
  });

  it("encodes what RFC 5987 does not allow as it stands", () => {
    expect(contentDisposition("inline", "it's (1).pdf")).toContain("filename*=UTF-8''it%27s%20%281%29.pdf");
  });
});
