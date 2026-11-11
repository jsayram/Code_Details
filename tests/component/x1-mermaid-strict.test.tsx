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
// mermaid is ESM-only; this file compiles as CommonJS, so types come in with resolution-mode.
import type { Mermaid } from "mermaid" with { "resolution-mode": "import" };
import { MermaidDiagram, mermaidConfig } from "@/components/created_mds/MermaidDiagram";

const SVG = '<svg id="mermaid-synthetic"><g><text>Start</text></g></svg>';
const h = vi.hoisted(() => ({ initialized: [] as Record<string, unknown>[] }));

// The real mermaid, except render(): jsdom can't lay a diagram out. initialize
// is recorded and still applied, so the parser below runs with that config.
vi.mock("mermaid", async (importOriginal) => {
  const real = ((await importOriginal()) as { default: Mermaid }).default;
  return {
    default: {
      ...real,
      initialize: (config: Parameters<typeof real.initialize>[0]) => {
        h.initialized.push(config as Record<string, unknown>);
        real.initialize(config);
      },
      render: async () => ({ svg: SVG, diagramType: "flowchart" }),
    },
  };
});

const CHART = 'flowchart TD\n  A["Start"] --> B["End"]\n  click A href "javascript:alert(document.domain)"';

async function linkOfA(config: Parameters<Mermaid["initialize"]>[0]) {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize(config);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(CHART);
  return (diagram.db as unknown as { getVertices(): Map<string, { link?: string }> }).getVertices().get("A")?.link;
}

afterEach(() => {
  cleanup();
  h.initialized = [];
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
    const { container } = render(<MermaidDiagram chart={CHART} />);
    await waitFor(() => expect(container.querySelector("#mermaid-synthetic")).not.toBeNull());
    expect(h.initialized).toEqual([expect.objectContaining({ securityLevel: "strict" })]);
    expect(container.innerHTML).not.toMatch(/javascript:/i);
    expect(container.querySelectorAll("[onerror],[onclick],[onload]")).toHaveLength(0);
  });
});
