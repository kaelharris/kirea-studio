import { describe, expect, it } from "vitest";
import {
  buildStoryboardHtml,
  escapeHtml,
  storySlug,
  type StoryboardHtmlPage,
} from "../../src/shared/canvas-html";

const CANVAS = {
  background: "#101018",
  pageWidth: 1123,
  pageHeight: 794,
};

function page(overrides: Partial<StoryboardHtmlPage> = {}): StoryboardHtmlPage {
  return {
    width: 1123,
    height: 794,
    panels: [
      {
        slot: { x: 32, y: 32, width: 521.5, height: 232.67 },
        imageSrc: null,
        fit: "cover",
        caption: "",
        overlays: [],
        alt: "Panel",
      },
    ],
    ...overrides,
  };
}

describe("Storyboard HTML", () => {
  it("escapes markup and derives safe slugs", () => {
    expect(escapeHtml(`<script>"&'`)).toBe(
      "&lt;script&gt;&quot;&amp;&#39;"
    );
    expect(storySlug("The Lantern Keeper")).toBe("the-lantern-keeper");
    expect(storySlug("Café Été — Part 1")).toBe("cafe-ete-part-1");
    expect(storySlug("???")).toBe("story");
    expect(storySlug("x".repeat(120)).length).toBe(60);
  });

  it("renders one section per page with page numbers only when paginated", () => {
    const single = buildStoryboardHtml({
      canvas: CANVAS,
      pages: [page()],
      title: "Story",
    });
    expect(single.match(/class="page"/g)).toHaveLength(1);
    expect(single).not.toContain('class="page-number"');

    const multi = buildStoryboardHtml({
      canvas: CANVAS,
      pages: [page(), page()],
      title: "Story",
    });
    expect(multi.match(/class="page"/g)).toHaveLength(2);
    expect(multi).toContain(">1 / 2<");
    expect(multi).toContain(">2 / 2<");
  });

  it("positions panels with slot geometry and escapes the title", () => {
    const html = buildStoryboardHtml({
      canvas: CANVAS,
      pages: [page()],
      title: "<Keeper> & Co",
    });
    expect(html).toContain("<title>&lt;Keeper&gt; &amp; Co</title>");
    expect(html).toContain(
      "left:32px;top:32px;width:521.5px;height:232.67px"
    );
    expect(html).toContain("@page { size: 1123px 794px; margin: 0; }");
    expect(html).toContain("background:#101018");
  });

  it("renders image fit, captions, placeholders, and overlays", () => {
    const html = buildStoryboardHtml({
      canvas: CANVAS,
      pages: [
        page({
          panels: [
            {
              slot: { x: 10, y: 20, width: 300, height: 200 },
              imageSrc: "kirea-media://image/?p=C%3A%5Cout%5Ca.png",
              fit: "contain",
              caption: "The <keeper> returns",
              alt: "Keeper at the cliff",
              overlays: [
                {
                  id: "ov_1",
                  kind: "speech",
                  speaker: "Mira",
                  text: "Hold <the> light.",
                  x: 0.5,
                  y: 0.25,
                },
                {
                  id: "ov_2",
                  kind: "narration",
                  text: "Night falls.",
                  x: 1.4,
                  y: -1,
                },
                {
                  id: "ov_3",
                  kind: "thought",
                  text: "Maybe.",
                  x: 0.2,
                  y: 0.8,
                },
              ],
            },
            {
              slot: { x: 320, y: 20, width: 300, height: 200 },
              imageSrc: null,
              fit: "cover",
              caption: "",
              overlays: [],
              alt: "Empty panel",
            },
          ],
        }),
      ],
      title: "Storyboard",
    });

    expect(html).toContain('src="kirea-media://image/?p=C%3A%5Cout%5Ca.png"');
    expect(html).toContain('alt="Keeper at the cliff"');
    expect(html).toContain("object-fit:contain");
    expect(html).toContain(">The &lt;keeper&gt; returns<");
    expect(html).toContain('class="placeholder">No image<');
    expect(html).toContain('class="overlay speech" style="left:50.00%;top:25.00%"');
    expect(html).toContain('<span class="speaker">Mira</span>');
    expect(html).toContain("Hold &lt;the&gt; light.");
    expect(html).toContain('class="overlay narration" style="left:100.00%;top:0.00%"');
    expect(html).toContain('class="overlay thought" style="left:20.00%;top:80.00%"');
  });

  it("falls back to a safe background colour", () => {
    const html = buildStoryboardHtml({
      canvas: { ...CANVAS, background: "javascript:alert(1)" },
      pages: [page()],
      title: "Unsafe",
    });
    expect(html).toContain("background:#0B0B0F");
    expect(html).not.toContain("javascript:");
  });
});
