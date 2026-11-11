// S04-URL: what /search reads from and writes to its address. Every value is
// checked: the query is cut to the API's limit, the tab comes from the known
// set, the category from the known keys, and defaults stay out of the address.
import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, checkRequest } from "@/backend/search/search-rules";
import { clampQuery, parseCategory, parseSearchUrl, parseTab, searchUrlString } from "@/components/search/search-url-state";

const parse = (s: string) => parseSearchUrl(new URLSearchParams(s));

describe("parseSearchUrl", () => {
  it("reads q, tab and category", () => {
    expect(parse("q=react&tab=tags&category=web")).toEqual({ q: "react", tab: "tags", category: "web" });
  });

  it("defaults to no query and the All tab", () => {
    expect(parse("")).toEqual({ q: "", tab: "all" });
    expect(parse("q=")).toEqual({ q: "", tab: "all" });
  });

  it("drops the tab and category without a query", () => {
    expect(parse("tab=users&category=web")).toEqual({ q: "", tab: "all" });
    expect(parse("q=%20%20&tab=users&category=web")).toEqual({ q: "", tab: "all" });
  });

  it("refuses an unknown tab or category", () => {
    expect(parse("q=a&tab=admin&category=nope")).toEqual({ q: "a", tab: "all" });
    expect(parse("q=a&tab=ALL")).toEqual({ q: "a", tab: "all" });
    // Inherited object keys are not categories.
    expect(parse("q=a&category=constructor").category).toBeUndefined();
    expect(parse("q=a&category=__proto__").category).toBeUndefined();
  });

  it("uses the first value when a parameter repeats", () => {
    expect(parse("q=one&q=two&tab=tags&tab=users")).toEqual({ q: "one", tab: "tags" });
  });

  it("cuts a long query to the API's limit, so the API never refuses a shared link for length", () => {
    const long = "a".repeat(MAX_QUERY_LENGTH + 50);
    const { q } = parse(`q=${long}`);
    expect(q).toHaveLength(MAX_QUERY_LENGTH);
    expect(checkRequest({ q }).filter((i) => i.message.includes("characters"))).toEqual([]);
  });

  it("keeps markup as plain text (React renders it as text)", () => {
    expect(parse("q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E").q).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("clampQuery", () => {
  it("leaves a short query alone", () => {
    expect(clampQuery("c#")).toBe("c#");
  });

  it("never splits a surrogate pair", () => {
    const q = "a".repeat(MAX_QUERY_LENGTH - 1) + "😀";
    expect(clampQuery(q)).toBe("a".repeat(MAX_QUERY_LENGTH - 1));
    expect(clampQuery("😀".repeat(MAX_QUERY_LENGTH))).toHaveLength(MAX_QUERY_LENGTH);
  });
});

describe("parseTab and parseCategory", () => {
  it("accept only the known values", () => {
    expect(["all", "categories", "tags", "users"].map(parseTab)).toEqual(["all", "categories", "tags", "users"]);
    expect([null, undefined, "", "projects"].map(parseTab)).toEqual(["all", "all", "all", "all"]);
    expect(parseCategory("web")).toBe("web");
    expect([null, undefined, "", "Web", "toString"].map(parseCategory)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("searchUrlString", () => {
  it("writes only what differs from the defaults", () => {
    expect(searchUrlString({ q: "react", tab: "all" })).toBe("q=react");
    expect(searchUrlString({ q: "react", tab: "tags", category: "web" })).toBe("q=react&tab=tags&category=web");
  });

  it("removes every parameter for an empty query", () => {
    expect(searchUrlString({ q: "", tab: "tags", category: "web" }, "q=old&tab=tags&category=web")).toBe("");
    expect(searchUrlString({ q: "   ", tab: "all" }, "q=old")).toBe("");
  });

  it("keeps parameters it doesn't own", () => {
    expect(searchUrlString({ q: "go", tab: "all" }, "ref=home&q=old&tab=users")).toBe("ref=home&q=go");
  });

  it("checks values again on the way out", () => {
    // A caller holding an unchecked value still writes a valid address.
    expect(searchUrlString({ q: "x".repeat(MAX_QUERY_LENGTH + 1), tab: "nope" as never, category: "nope" as never })).toBe(`q=${"x".repeat(MAX_QUERY_LENGTH)}`);
  });

  it("encodes the query, and reading it back gives the same state", () => {
    const state = { q: "c++ & c# ?x=1", tab: "users" as const, category: "cloud-devops" as const };
    const s = searchUrlString(state);
    expect(s).not.toContain("&x=1");
    expect(parse(s)).toEqual(state);
  });
});
