// @vitest-environment jsdom
// X1: Mermaid diagrams in generated docs render with securityLevel 'strict'.
// Under 'loose', mermaid kept a `click X href "javascript:..."` link as is and
// skipped DOMPurify on the SVG, so clicking the node ran script. jsdom can't
// run mermaid's layout (render() never settles here), so this checks the real
// parser with the viewer's own settings, and that the component asks for
// strict and shows only what mermaid's render returned. The full render and
// click are covered in the browser by tests/e2e/x1-mermaid-xss.spec.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { mermaidConfig } from "@/components/created_mds/MermaidDiagram";

const CHART = 'flowchart TD\n  A["Start"] --> B["End"]\n  click A href "javascript:alert(document.domain)"';

async function linkOfA(config: Parameters<typeof import("mermaid").default.initialize>[0]) {
  const mermaid = (await vi.importActual<typeof import("mermaid")>("mermaid")).default;
  mermaid.initialize(config);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(CHART);
  return (diagram.db as unknown as { getVertices(): Map<string, { link?: string }> }).getVertices().get("A")?.link;
}

afterEach(() => {
  cleanup();
  vi.doUnmock("mermaid");
  vi.resetModules();
});

describe("Mermaid security level", () => {
  it("the viewer's settings are strict, in both themes", () => {
    expect(mermaidConfig(false).securityLevel).toBe("strict");
    expect(mermaidConfig(true).securityLevel).toBe("strict");
  });

  it("with those settings mermaid drops a javascript: node link", async () => {
    expect(await linkOfA(mermaidConfig(false))).toBe("about:blank");
  });

  it("control: under 'loose' the same link survives, so the check above can fail", async () => {
    expect(await linkOfA({ ...mermaidConfig(false), securityLevel: "loose" })).toMatch(/^javascript:/);
  });

  it("the component initializes strict and inserts only mermaid's rendered SVG", async () => {
    const initialize = vi.fn();
    const svg = '<svg id="mermaid-synthetic"><g><text>Start</text></g></svg>';
    vi.doMock("mermaid", () => ({
      default: { initialize, parse: vi.fn(async () => true), render: vi.fn(async () => ({ svg })) },
    }));
    const { MermaidDiagram } = await import("@/components/created_mds/MermaidDiagram");
    const { container } = render(<MermaidDiagram chart={CHART} />);
    await waitFor(() => expect(container.querySelector("#mermaid-synthetic")).not.toBeNull());
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
    expect(container.innerHTML).not.toMatch(/javascript:/i);
    expect(container.querySelectorAll("[onerror],[onclick],[onload]")).toHaveLength(0);
  });
});
