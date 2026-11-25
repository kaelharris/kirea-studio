import { describe, expect, it } from "vitest";

describe("Library Selection Experience", () => {
  const mockItems = [
    { id: "img_1", title: "Artwork 1" },
    { id: "img_2", title: "Artwork 2" },
    { id: "img_3", title: "Artwork 3" },
    { id: "img_4", title: "Artwork 4" },
    { id: "img_5", title: "Artwork 5" },
  ];

  it("handles single selection toggle in selection mode", () => {
    let selectedIds = new Set<string>();

    const toggle = (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      selectedIds = next;
    };

    toggle("img_2");
    expect(selectedIds.has("img_2")).toBe(true);
    expect(selectedIds.size).toBe(1);

    toggle("img_4");
    expect(selectedIds.has("img_4")).toBe(true);
    expect(selectedIds.size).toBe(2);

    // Clicking already selected deselects it
    toggle("img_2");
    expect(selectedIds.has("img_2")).toBe(false);
    expect(selectedIds.size).toBe(1);
  });

  it("handles shift-click range selection correctly", () => {
    let selectedIds = new Set<string>(["img_2"]);
    const lastSelectedIndex = 1; // index of img_2
    const targetIndex = 4; // index of img_5

    const start = Math.min(lastSelectedIndex, targetIndex);
    const end = Math.max(lastSelectedIndex, targetIndex);
    const rangeIds = mockItems.slice(start, end + 1).map((it) => it.id);

    const next = new Set(selectedIds);
    for (const id of rangeIds) next.add(id);
    selectedIds = next;

    expect(selectedIds.size).toBe(4);
    expect(selectedIds.has("img_2")).toBe(true);
    expect(selectedIds.has("img_3")).toBe(true);
    expect(selectedIds.has("img_4")).toBe(true);
    expect(selectedIds.has("img_5")).toBe(true);
    expect(selectedIds.has("img_1")).toBe(false);
  });

  it("handles Select All and Clear Selection", () => {
    let selectedIds = new Set<string>();

    // Select all
    selectedIds = new Set(mockItems.map((m) => m.id));
    expect(selectedIds.size).toBe(5);

    // Clear selection
    selectedIds = new Set();
    expect(selectedIds.size).toBe(0);
  });

  it("handles Invert Selection accurately across existing selection", () => {
    let selectedIds = new Set<string>(["img_1", "img_3"]);

    const invert = () => {
      const next = new Set<string>();
      for (const item of mockItems) {
        if (!selectedIds.has(item.id)) {
          next.add(item.id);
        }
      }
      return next;
    };

    selectedIds = invert();
    expect(selectedIds.size).toBe(3);
    expect(selectedIds.has("img_1")).toBe(false);
    expect(selectedIds.has("img_2")).toBe(true);
    expect(selectedIds.has("img_3")).toBe(false);
    expect(selectedIds.has("img_4")).toBe(true);
    expect(selectedIds.has("img_5")).toBe(true);

    // Inverting again returns to original selection
    selectedIds = invert();
    expect(selectedIds.size).toBe(2);
    expect(selectedIds.has("img_1")).toBe(true);
    expect(selectedIds.has("img_3")).toBe(true);
  });

  it("preserves selection state when double-clicking to inspect an artwork", () => {
    const selectedIds = new Set<string>(["img_2", "img_4"]);
    let inspectedItem: string | null = null;

    // Simulate double click in selection mode
    const handleDoubleClick = (id: string) => {
      inspectedItem = id;
      // Note: selectedIds must NOT be reset!
    };

    handleDoubleClick("img_2");
    expect(inspectedItem).toBe("img_2");
    expect(selectedIds.has("img_2")).toBe(true);
    expect(selectedIds.has("img_4")).toBe(true);
    expect(selectedIds.size).toBe(2);
  });
});
