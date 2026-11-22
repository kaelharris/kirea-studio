import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckSquare,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Scissors,
  Trash2,
} from "lucide-react";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  destructive?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

export interface ContextMenuOptions {
  x: number;
  y: number;
  items: ContextMenuItem[];
  title?: string;
}

export interface ContextMenuContextValue {
  showContextMenu: (opts: ContextMenuOptions) => void;
  hideContextMenu: () => void;
  isOpen: boolean;
}

/**
 * Pure helper to clamp menu coordinates within visible viewport boundaries.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8
): { x: number; y: number } {
  let clampedX = x;
  let clampedY = y;

  if (clampedX + menuWidth > viewportWidth - padding) {
    clampedX = Math.max(padding, viewportWidth - menuWidth - padding);
  } else {
    clampedX = Math.max(padding, clampedX);
  }

  if (clampedY + menuHeight > viewportHeight - padding) {
    clampedY = Math.max(padding, viewportHeight - menuHeight - padding);
  } else {
    clampedY = Math.max(padding, clampedY);
  }

  return { x: clampedX, y: clampedY };
}

/**
 * Pure helper to clamp submenu coordinates within visible viewport boundaries.
 */
export function clampSubmenuPosition(
  parentRect: { left: number; right: number; top: number; bottom: number },
  submenuWidth: number,
  submenuHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  padding = 8
): { x: number; y: number } {
  // Preferred: open to right
  let x = parentRect.right + 2;
  if (x + submenuWidth > viewportWidth - padding) {
    // Flip to left
    x = parentRect.left - submenuWidth - 2;
  }
  x = Math.max(padding, Math.min(x, viewportWidth - submenuWidth - padding));

  let y = parentRect.top - 4;
  if (y + submenuHeight > viewportHeight - padding) {
    y = Math.max(padding, viewportHeight - submenuHeight - padding);
  }
  y = Math.max(padding, y);

  return { x, y };
}

/**
 * Calculates next selectable index skipping dividers and disabled items.
 */
export function getNextFocusIndex(
  currentIndex: number,
  direction: 1 | -1,
  items: ContextMenuItem[]
): number {
  if (items.length === 0) return -1;
  const validIndices: number[] = [];
  items.forEach((item, idx) => {
    if (!item.disabled && !item.separator) {
      validIndices.push(idx);
    }
  });

  if (validIndices.length === 0) return -1;

  if (currentIndex === -1) {
    return direction === 1 ? validIndices[0]! : validIndices[validIndices.length - 1]!;
  }

  const currentPos = validIndices.indexOf(currentIndex);
  if (currentPos === -1) {
    return validIndices[0]!;
  }

  const nextPos = (currentPos + direction + validIndices.length) % validIndices.length;
  return validIndices[nextPos]!;
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null);

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    throw new Error("useContextMenu must be used within a ContextMenuProvider");
  }
  return ctx;
}

export const ContextMenuProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [activeMenu, setActiveMenu] = useState<ContextMenuOptions | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<{
    id: string;
    parentRect: { left: number; right: number; top: number; bottom: number };
    items: ContextMenuItem[];
  } | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [submenuFocusedIndex, setSubmenuFocusedIndex] = useState<number>(-1);

  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const [adjustedCoords, setAdjustedCoords] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [adjustedSubmenuCoords, setAdjustedSubmenuCoords] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });

  const showContextMenu = useCallback((opts: ContextMenuOptions) => {
    if (opts.items.length === 0) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    let { x, y } = opts;
    // Fallback for keyboard triggers (Shift+F10 or ContextMenu key) where coordinates are 0,0 or invalid
    if ((x <= 0 && y <= 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && typeof activeEl.getBoundingClientRect === "function") {
        const rect = activeEl.getBoundingClientRect();
        x = Math.round(rect.left + rect.width / 2);
        y = Math.round(rect.top + rect.height / 2);
      } else {
        x = Math.round(window.innerWidth / 2);
        y = Math.round(window.innerHeight / 2);
      }
    }

    setActiveMenu({ ...opts, x, y });
    setActiveSubmenu(null);
    setFocusedIndex(-1);
    setSubmenuFocusedIndex(-1);
    setAdjustedCoords({ x, y });
  }, []);

  const hideContextMenu = useCallback(() => {
    setActiveMenu(null);
    setActiveSubmenu(null);
    setFocusedIndex(-1);
    setSubmenuFocusedIndex(-1);
    if (previousActiveElementRef.current) {
      try {
        previousActiveElementRef.current.focus();
      } catch {
        // Ignore focus restore failure
      }
      previousActiveElementRef.current = null;
    }
  }, []);

  // Measure and clamp main menu position after mount
  useLayoutEffect(() => {
    if (!activeMenu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const clamped = clampMenuPosition(
      activeMenu.x,
      activeMenu.y,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    );
    setAdjustedCoords(clamped);
  }, [activeMenu]);

  // Measure and clamp submenu position when opened
  useLayoutEffect(() => {
    if (!activeSubmenu || !submenuRef.current) return;
    const rect = submenuRef.current.getBoundingClientRect();
    const clamped = clampSubmenuPosition(
      activeSubmenu.parentRect,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight
    );
    setAdjustedSubmenuCoords(clamped);
  }, [activeSubmenu]);

  // Handle outside click dismissal
  useEffect(() => {
    if (!activeMenu) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!submenuRef.current || !submenuRef.current.contains(target))
      ) {
        hideContextMenu();
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("touchstart", handlePointerDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("touchstart", handlePointerDown, true);
    };
  }, [activeMenu, hideContextMenu]);

  // Keyboard navigation & accessibility
  useEffect(() => {
    if (!activeMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes submenu or entire menu
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (activeSubmenu) {
          setActiveSubmenu(null);
          setSubmenuFocusedIndex(-1);
        } else {
          hideContextMenu();
        }
        return;
      }

      // If active submenu is focused
      if (activeSubmenu && submenuFocusedIndex >= 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSubmenuFocusedIndex((prev) =>
            getNextFocusIndex(prev, 1, activeSubmenu.items)
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSubmenuFocusedIndex((prev) =>
            getNextFocusIndex(prev, -1, activeSubmenu.items)
          );
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setActiveSubmenu(null);
          setSubmenuFocusedIndex(-1);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const targetItem = activeSubmenu.items[submenuFocusedIndex];
          if (targetItem && !targetItem.disabled && targetItem.onClick) {
            targetItem.onClick();
            hideContextMenu();
          }
          return;
        }
      }

      // Main menu keyboard navigation
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => getNextFocusIndex(prev, 1, activeMenu.items));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => getNextFocusIndex(prev, -1, activeMenu.items));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(getNextFocusIndex(-1, 1, activeMenu.items));
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setFocusedIndex(getNextFocusIndex(activeMenu.items.length, -1, activeMenu.items));
        return;
      }
      if (e.key === "ArrowRight") {
        if (focusedIndex >= 0) {
          const item = activeMenu.items[focusedIndex];
          if (item?.children && item.children.length > 0) {
            e.preventDefault();
            const itemEl = menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']")[focusedIndex];
            const rect = itemEl?.getBoundingClientRect() ?? {
              left: adjustedCoords.x,
              right: adjustedCoords.x + 200,
              top: adjustedCoords.y,
              bottom: adjustedCoords.y + 30,
            };
            setActiveSubmenu({
              id: item.id,
              parentRect: rect,
              items: item.children,
            });
            setSubmenuFocusedIndex(getNextFocusIndex(-1, 1, item.children));
          }
        }
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        if (focusedIndex >= 0) {
          e.preventDefault();
          const item = activeMenu.items[focusedIndex];
          if (!item || item.disabled) return;
          if (item.children && item.children.length > 0) {
            const itemEl = menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']")[focusedIndex];
            const rect = itemEl?.getBoundingClientRect() ?? {
              left: adjustedCoords.x,
              right: adjustedCoords.x + 200,
              top: adjustedCoords.y,
              bottom: adjustedCoords.y + 30,
            };
            setActiveSubmenu({
              id: item.id,
              parentRect: rect,
              items: item.children,
            });
            setSubmenuFocusedIndex(getNextFocusIndex(-1, 1, item.children));
          } else if (item.onClick) {
            item.onClick();
            hideContextMenu();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [activeMenu, activeSubmenu, focusedIndex, submenuFocusedIndex, adjustedCoords, hideContextMenu]);

  const handleItemHover = (
    item: ContextMenuItem,
    index: number,
    itemEl: HTMLElement
  ) => {
    setFocusedIndex(index);
    if (item.children && item.children.length > 0) {
      const rect = itemEl.getBoundingClientRect();
      setActiveSubmenu({
        id: item.id,
        parentRect: rect,
        items: item.children,
      });
      setSubmenuFocusedIndex(-1);
    } else {
      setActiveSubmenu(null);
      setSubmenuFocusedIndex(-1);
    }
  };

  // Global right-click handler for editable text inputs, textareas, and window text selections
  useEffect(() => {
    const handleGlobalContextMenu = async (e: MouseEvent) => {
      // If a component already handled this context menu (e.g. MediaCard, CharacterCard, PromptComposer), do not interfere!
      if (e.defaultPrevented) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const isInput =
        target instanceof HTMLInputElement &&
        !["checkbox", "radio", "button", "submit", "file", "color", "range"].includes(
          target.type
        );
      const isTextArea = target instanceof HTMLTextAreaElement;
      const isContentEditable = target.isContentEditable;

      // Case 1: Editable inputs and textareas
      if (isInput || isTextArea || isContentEditable) {
        e.preventDefault();
        target.focus();

        let hasSelection = false;
        let selectedText = "";
        let hasText = false;
        let isReadOnly = false;

        if (isInput || isTextArea) {
          const el = target as HTMLInputElement | HTMLTextAreaElement;
          isReadOnly = el.readOnly || el.disabled;
          const start = el.selectionStart ?? 0;
          const end = el.selectionEnd ?? 0;
          selectedText = el.value.substring(start, end);
          hasSelection = selectedText.length > 0;
          hasText = el.value.length > 0;
        } else if (isContentEditable) {
          const selection = window.getSelection();
          selectedText = selection?.toString() ?? "";
          hasSelection = selectedText.length > 0;
          hasText = (target.textContent ?? "").length > 0;
        }

        const items: ContextMenuItem[] = [
          {
            id: "text-cut",
            label: "Cut",
            icon: <Scissors className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+X",
            disabled: !hasSelection || isReadOnly,
            disabledReason: isReadOnly ? "Field is read-only" : "No text selected",
            onClick: async () => {
              if (!hasSelection || isReadOnly) return;
              try {
                await navigator.clipboard.writeText(selectedText);
                document.execCommand("insertText", false, "");
              } catch {
                document.execCommand("cut");
              }
            },
          },
          {
            id: "text-copy",
            label: "Copy",
            icon: <Copy className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+C",
            disabled: !hasSelection && !hasText,
            disabledReason: "Nothing to copy",
            onClick: async () => {
              const textToCopy = hasSelection
                ? selectedText
                : isInput || isTextArea
                ? (target as HTMLInputElement | HTMLTextAreaElement).value
                : target.textContent ?? "";
              try {
                await navigator.clipboard.writeText(textToCopy);
              } catch {
                document.execCommand("copy");
              }
            },
          },
          {
            id: "text-paste",
            label: "Paste",
            icon: <ClipboardPaste className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+V",
            disabled: isReadOnly,
            disabledReason: isReadOnly ? "Field is read-only" : undefined,
            separator: true,
            onClick: async () => {
              if (isReadOnly) return;
              target.focus();
              try {
                const clip = await navigator.clipboard.readText();
                if (clip) {
                  const handled = document.execCommand("insertText", false, clip);
                  if (!handled && (isInput || isTextArea)) {
                    const el = target as HTMLInputElement | HTMLTextAreaElement;
                    const start = el.selectionStart ?? 0;
                    const end = el.selectionEnd ?? 0;
                    const val = el.value;
                    const newVal = val.slice(0, start) + clip + val.slice(end);
                    const setter = isInput
                      ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
                      : Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
                    if (setter) {
                      setter.call(el, newVal);
                    } else {
                      el.value = newVal;
                    }
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                    const nextPos = start + clip.length;
                    el.setSelectionRange(nextPos, nextPos);
                  }
                }
              } catch {
                document.execCommand("paste");
              }
            },
          },
          {
            id: "text-select-all",
            label: "Select All",
            icon: <CheckSquare className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+A",
            disabled: !hasText,
            disabledReason: "Field is empty",
            onClick: () => {
              target.focus();
              if (isInput || isTextArea) {
                (target as HTMLInputElement | HTMLTextAreaElement).select();
              } else if (isContentEditable) {
                const range = document.createRange();
                range.selectNodeContents(target);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            },
          },
          {
            id: "text-delete",
            label: "Delete",
            icon: <Trash2 className="w-3.5 h-3.5" />,
            disabled: !hasSelection || isReadOnly,
            disabledReason: isReadOnly ? "Field is read-only" : "No text selected",
            onClick: () => {
              if (!hasSelection || isReadOnly) return;
              target.focus();
              document.execCommand("insertText", false, "");
            },
          },
        ];

        showContextMenu({
          x: e.clientX,
          y: e.clientY,
          items,
        });
        return;
      }

      // Case 2: Text selection anywhere in the window
      const selection = window.getSelection();
      const selectedText = selection?.toString() ?? "";
      if (selectedText.trim().length > 0) {
        e.preventDefault();
        const items: ContextMenuItem[] = [
          {
            id: "selection-copy",
            label: "Copy",
            icon: <Copy className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+C",
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(selectedText);
              } catch {
                document.execCommand("copy");
              }
            },
          },
          {
            id: "selection-select-all",
            label: "Select All",
            icon: <CheckSquare className="w-3.5 h-3.5" />,
            shortcut: "Ctrl+A",
            onClick: () => {
              document.execCommand("selectAll");
            },
          },
        ];

        showContextMenu({
          x: e.clientX,
          y: e.clientY,
          items,
        });
      }
    };

    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => window.removeEventListener("contextmenu", handleGlobalContextMenu);
  }, [showContextMenu]);

  return (
    <ContextMenuContext.Provider
      value={{
        showContextMenu,
        hideContextMenu,
        isOpen: activeMenu !== null,
      }}
    >
      {children}

      {activeMenu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            tabIndex={-1}
            className="fixed z-[9999] min-w-[200px] max-w-[320px] rounded-lg border border-border bg-[#1c1c20] p-1 shadow-2xl shadow-black/80 font-sans text-xs select-none animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: `${adjustedCoords.x}px`,
              top: `${adjustedCoords.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {activeMenu.title && (
              <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-fg-subtle border-b border-border/50 mb-1">
                {activeMenu.title}
              </div>
            )}

            {activeMenu.items.map((item, index) => {
              const isFocused = focusedIndex === index;
              const hasSubmenu = Boolean(item.children && item.children.length > 0);
              const isSubmenuActive = activeSubmenu?.id === item.id;

              return (
                <React.Fragment key={item.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    aria-disabled={item.disabled}
                    aria-haspopup={hasSubmenu ? "menu" : undefined}
                    aria-expanded={hasSubmenu ? isSubmenuActive : undefined}
                    title={item.disabled ? item.disabledReason : undefined}
                    onMouseEnter={(e) => handleItemHover(item, index, e.currentTarget)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (item.disabled) return;
                      if (hasSubmenu) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setActiveSubmenu({
                          id: item.id,
                          parentRect: rect,
                          items: item.children!,
                        });
                        setSubmenuFocusedIndex(getNextFocusIndex(-1, 1, item.children!));
                      } else {
                        item.onClick?.();
                        hideContextMenu();
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors duration-100 ${
                      item.disabled
                        ? "opacity-40 cursor-not-allowed text-fg-muted"
                        : item.destructive
                        ? isFocused
                          ? "bg-danger-soft text-danger font-medium"
                          : "text-danger hover:bg-danger-soft"
                        : isFocused || isSubmenuActive
                        ? "bg-accent-soft text-accent-hover font-medium"
                        : "text-fg hover:bg-surface-subtle"
                    }`}
                  >
                    {item.icon && (
                      <span className="shrink-0 w-4 h-4 flex items-center justify-center [&_svg]:w-3.5 [&_svg]:h-3.5">
                        {item.icon}
                      </span>
                    )}

                    <span className="flex-1 truncate">{item.label}</span>

                    {item.shortcut && (
                      <span className="shrink-0 font-mono text-[10px] text-fg-subtle tracking-wider ml-auto pl-3">
                        {item.shortcut}
                      </span>
                    )}

                    {hasSubmenu && (
                      <ChevronRight className="shrink-0 w-3.5 h-3.5 text-fg-subtle ml-auto" />
                    )}
                  </button>

                  {item.separator && (
                    <div className="h-px my-1 bg-border/60 -mx-1" role="separator" />
                  )}
                </React.Fragment>
              );
            })}
          </div>,
          document.body
        )}

      {/* SUBMENU PORTAL */}
      {activeSubmenu &&
        createPortal(
          <div
            ref={submenuRef}
            role="menu"
            aria-orientation="vertical"
            tabIndex={-1}
            className="fixed z-[10000] min-w-[180px] max-w-[280px] rounded-lg border border-border bg-[#1c1c20] p-1 shadow-2xl shadow-black/80 font-sans text-xs select-none animate-in fade-in zoom-in-95 duration-100"
            style={{
              left: `${adjustedSubmenuCoords.x}px`,
              top: `${adjustedSubmenuCoords.y}px`,
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {activeSubmenu.items.map((subItem, subIndex) => {
              const isSubFocused = submenuFocusedIndex === subIndex;

              return (
                <React.Fragment key={subItem.id}>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={subItem.disabled}
                    aria-disabled={subItem.disabled}
                    title={subItem.disabled ? subItem.disabledReason : undefined}
                    onMouseEnter={() => setSubmenuFocusedIndex(subIndex)}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (subItem.disabled) return;
                      subItem.onClick?.();
                      hideContextMenu();
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors duration-100 ${
                      subItem.disabled
                        ? "opacity-40 cursor-not-allowed text-fg-muted"
                        : subItem.destructive
                        ? isSubFocused
                          ? "bg-danger-soft text-danger font-medium"
                          : "text-danger hover:bg-danger-soft"
                        : isSubFocused
                        ? "bg-accent-soft text-accent-hover font-medium"
                        : "text-fg hover:bg-surface-subtle"
                    }`}
                  >
                    {subItem.icon && (
                      <span className="shrink-0 w-4 h-4 flex items-center justify-center [&_svg]:w-3.5 [&_svg]:h-3.5">
                        {subItem.icon}
                      </span>
                    )}

                    <span className="flex-1 truncate">{subItem.label}</span>

                    {subItem.shortcut && (
                      <span className="shrink-0 font-mono text-[10px] text-fg-subtle tracking-wider ml-auto pl-3">
                        {subItem.shortcut}
                      </span>
                    )}
                  </button>

                  {subItem.separator && (
                    <div className="h-px my-1 bg-border/60 -mx-1" role="separator" />
                  )}
                </React.Fragment>
              );
            })}
          </div>,
          document.body
        )}
    </ContextMenuContext.Provider>
  );
};

/**
 * Ergonomic helper hook to attach context menu trigger to any component or element.
 */
export function useContextMenuTrigger<T = void>(
  getItems: (
    target: T,
    e: React.MouseEvent | React.KeyboardEvent
  ) => ContextMenuItem[] | null | undefined,
  options?: {
    title?: string | ((target: T) => string | undefined);
  }
) {
  const { showContextMenu } = useContextMenu();

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, target: T) => {
      e.preventDefault();
      e.stopPropagation();

      const items = getItems(target, e);
      if (!items || items.length === 0) return;

      const title =
        typeof options?.title === "function"
          ? options.title(target)
          : options?.title;

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        items,
        title,
      });
    },
    [getItems, options, showContextMenu]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, target: T) => {
      // Support ContextMenu key or Shift+F10
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        e.stopPropagation();

        const items = getItems(target, e);
        if (!items || items.length === 0) return;

        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const title =
          typeof options?.title === "function"
            ? options.title(target)
            : options?.title;

        showContextMenu({
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          items,
          title,
        });
      }
    },
    [getItems, options, showContextMenu]
  );

  return { onContextMenu: handleContextMenu, onKeyDown: handleKeyDown };
}
