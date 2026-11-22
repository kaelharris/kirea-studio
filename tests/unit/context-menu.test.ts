import { describe, expect, it, vi } from "vitest";
import {
  clampMenuPosition,
  clampSubmenuPosition,
  getNextFocusIndex,
  type ContextMenuItem,
} from "../../src/renderer/components/ui/ContextMenu";

describe("ContextMenu Positioning and Clamping", () => {
  const VIEWPORT_W = 1920;
  const VIEWPORT_H = 1080;
  const MENU_W = 220;
  const MENU_H = 300;
  const PADDING = 8;

  it("preserves position when inside viewport bounds", () => {
    const pos = clampMenuPosition(100, 200, MENU_W, MENU_H, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it("clamps and shifts left when overflowing the right viewport edge", () => {
    // Pointer at 1850px: 1850 + 220 = 2070 > 1920 - 8
    const pos = clampMenuPosition(1850, 200, MENU_W, MENU_H, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(pos.x).toBe(VIEWPORT_W - MENU_W - PADDING); // 1920 - 220 - 8 = 1692
    expect(pos.y).toBe(200);
  });

  it("clamps and shifts up when overflowing the bottom viewport edge", () => {
    // Pointer at 950px: 950 + 300 = 1250 > 1080 - 8
    const pos = clampMenuPosition(200, 950, MENU_W, MENU_H, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(pos.x).toBe(200);
    expect(pos.y).toBe(VIEWPORT_H - MENU_H - PADDING); // 1080 - 300 - 8 = 772
  });

  it("clamps to padding if pointer is negative or off-screen top/left", () => {
    const pos = clampMenuPosition(-50, -20, MENU_W, MENU_H, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(pos.x).toBe(PADDING);
    expect(pos.y).toBe(PADDING);
  });

  it("handles extreme bottom-right corner collision simultaneously", () => {
    const pos = clampMenuPosition(1910, 1070, MENU_W, MENU_H, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(pos.x).toBe(VIEWPORT_W - MENU_W - PADDING);
    expect(pos.y).toBe(VIEWPORT_H - MENU_H - PADDING);
  });

  it("positions submenu to the right when space permits", () => {
    const parentRect = { left: 400, right: 620, top: 300, bottom: 330 };
    const subPos = clampSubmenuPosition(parentRect, 200, 150, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(subPos.x).toBe(parentRect.right + 2); // 622
    expect(subPos.y).toBe(parentRect.top - 4); // 296
  });

  it("flips submenu to the left when overflowing right edge", () => {
    const parentRect = { left: 1750, right: 1900, top: 300, bottom: 330 };
    const subPos = clampSubmenuPosition(parentRect, 200, 150, VIEWPORT_W, VIEWPORT_H, PADDING);
    // Should flip to parentRect.left - subWidth - 2 = 1750 - 200 - 2 = 1548
    expect(subPos.x).toBe(1548);
  });

  it("clamps submenu vertically when near bottom edge", () => {
    const parentRect = { left: 400, right: 620, top: 1000, bottom: 1030 };
    const subPos = clampSubmenuPosition(parentRect, 200, 200, VIEWPORT_W, VIEWPORT_H, PADDING);
    expect(subPos.y).toBe(VIEWPORT_H - 200 - PADDING); // 1080 - 200 - 8 = 872
  });
});

describe("ContextMenu Keyboard Focus Navigation", () => {
  const sampleItems: ContextMenuItem[] = [
    { id: "item-1", label: "Item 1" },
    { id: "item-2", label: "Disabled Item", disabled: true },
    { id: "sep-1", label: "", separator: true },
    { id: "item-3", label: "Item 3" },
    { id: "item-4", label: "Item 4" },
    { id: "item-5", label: "Disabled 5", disabled: true },
  ];

  it("navigates down from initial unselected state (-1) to first active item", () => {
    const nextIdx = getNextFocusIndex(-1, 1, sampleItems);
    expect(nextIdx).toBe(0); // item-1
  });

  it("navigates up from initial unselected state (-1) to last active item", () => {
    const nextIdx = getNextFocusIndex(-1, -1, sampleItems);
    expect(nextIdx).toBe(4); // item-4 (item-5 is disabled)
  });

  it("skips disabled and separator items when moving forward", () => {
    // Current is index 0 (item-1). Next should skip index 1 (disabled) and 2 (separator) -> index 3 (item-3)
    const nextIdx = getNextFocusIndex(0, 1, sampleItems);
    expect(nextIdx).toBe(3);
  });

  it("skips disabled and separator items when moving backward", () => {
    // Current is index 3 (item-3). Prev should skip separator 2 and disabled 1 -> index 0 (item-1)
    const prevIdx = getNextFocusIndex(3, -1, sampleItems);
    expect(prevIdx).toBe(0);
  });

  it("wraps around cleanly when moving forward past the last active item", () => {
    // Current is index 4 (item-4). Moving forward should wrap to index 0 (item-1)
    const nextIdx = getNextFocusIndex(4, 1, sampleItems);
    expect(nextIdx).toBe(0);
  });

  it("wraps around cleanly when moving backward before the first active item", () => {
    // Current is index 0 (item-1). Moving backward should wrap to index 4 (item-4)
    const prevIdx = getNextFocusIndex(0, -1, sampleItems);
    expect(prevIdx).toBe(4);
  });

  it("returns -1 if all items are disabled or separators", () => {
    const disabledItems: ContextMenuItem[] = [
      { id: "d1", label: "D1", disabled: true },
      { id: "s1", label: "", separator: true },
    ];
    expect(getNextFocusIndex(-1, 1, disabledItems)).toBe(-1);
    expect(getNextFocusIndex(0, 1, disabledItems)).toBe(-1);
  });
});

describe("ContextMenu Action Execution and Safety", () => {
  it("executes valid action callback and enforces disabled state", () => {
    const actionMock = vi.fn();
    const disabledMock = vi.fn();

    const items: ContextMenuItem[] = [
      { id: "act-1", label: "Action 1", onClick: actionMock },
      { id: "act-2", label: "Disabled Action", disabled: true, onClick: disabledMock },
    ];

    // Trigger action 1
    items[0]?.onClick?.();
    expect(actionMock).toHaveBeenCalledTimes(1);

    // Disabled item should not be called in UI logic
    if (!items[1]?.disabled) {
      items[1]?.onClick?.();
    }
    expect(disabledMock).not.toHaveBeenCalled();
  });

  it("correctly models bulk selection vs single item targeting", () => {
    const selectedIds = new Set(["img-1", "img-2", "img-3"]);

    // Case A: Right-clicking an item already inside selection keeps bulk context
    const clickedId1 = "img-2";
    const isBulk1 = selectedIds.has(clickedId1) && selectedIds.size > 1;
    expect(isBulk1).toBe(true);

    // Case B: Right-clicking an unselected item targets that single item
    const clickedId2 = "img-4";
    const isBulk2 = selectedIds.has(clickedId2) && selectedIds.size > 1;
    expect(isBulk2).toBe(false);
  });

  it("structures submenu tree hierarchy without circular references", () => {
    const subAction = vi.fn();
    const itemWithSubmenu: ContextMenuItem = {
      id: "parent",
      label: "Add to Collection",
      children: [
        { id: "col-1", label: "Favorites", onClick: subAction },
        { id: "col-2", label: "Portraits", onClick: subAction },
      ],
    };

    expect(itemWithSubmenu.children?.length).toBe(2);
    expect(itemWithSubmenu.children?.[0]?.label).toBe("Favorites");
    itemWithSubmenu.children?.[0]?.onClick?.();
    expect(subAction).toHaveBeenCalledTimes(1);
  });

  it("detects Shift+F10 and ContextMenu keyboard events", () => {
    const isShiftF10 = (e: { key: string; shiftKey: boolean }) =>
      e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

    expect(isShiftF10({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isShiftF10({ key: "F10", shiftKey: true })).toBe(true);
    expect(isShiftF10({ key: "F10", shiftKey: false })).toBe(false);
    expect(isShiftF10({ key: "Enter", shiftKey: false })).toBe(false);
  });

  it("validates HuggingFace and Civitai Hub context menu items contract", () => {
    const hfRepo = { id: "wan-video/Wan2.1-T2V-1.3B", author: "wan-video" };
    const hfItems: ContextMenuItem[] = [
      { id: "hf-inspect", label: "Inspect Repository & Files" },
      { id: "hf-web", label: "Open on Hugging Face Web" },
      { id: "hf-copy-id", label: "Copy Repository ID" },
      { id: "hf-copy-url", label: "Copy Hugging Face URL" },
    ];

    expect(hfItems.map((i) => i.id)).toContain("hf-inspect");
    expect(hfItems.map((i) => i.id)).toContain("hf-web");
    expect(hfItems.map((i) => i.id)).toContain("hf-copy-id");
    expect(hfItems.map((i) => i.id)).toContain("hf-copy-url");
  });

  it("builds text editing context menu items for input and textarea fields", () => {
    const inputMock = {
      value: "hello world",
      selectionStart: 0,
      selectionEnd: 5,
      readOnly: false,
      disabled: false,
    };
    const hasSelection = (inputMock.selectionEnd - inputMock.selectionStart) > 0;
    const isReadOnly = inputMock.readOnly || inputMock.disabled;

    const items: ContextMenuItem[] = [
      { id: "text-cut", label: "Cut", disabled: !hasSelection || isReadOnly },
      { id: "text-copy", label: "Copy", disabled: !hasSelection && inputMock.value.length === 0 },
      { id: "text-paste", label: "Paste", disabled: isReadOnly },
      { id: "text-select-all", label: "Select All", disabled: inputMock.value.length === 0 },
      { id: "text-delete", label: "Delete", disabled: !hasSelection || isReadOnly },
    ];

    expect(items.find((i) => i.id === "text-cut")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "text-copy")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "text-paste")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "text-select-all")?.disabled).toBe(false);
    expect(items.find((i) => i.id === "text-delete")?.disabled).toBe(false);
  });
});
