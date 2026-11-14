import React from "react";
import { Moon, Sun } from "lucide-react";
import type { NavSection } from "../../shared/types";
import { BrandMark } from "../components/BrandMark";
import { NAV_GROUPS, NAV_ITEMS } from "./app-constants";

interface SidebarNavProps {
  activePage: NavSection;
  activeWorkCount: number;
  theme: "dark" | "light";
  /** True when the stored preference is "system"; the toggle then pins an explicit theme. */
  followsSystem?: boolean;
  onSelectPage: (page: NavSection) => void;
  onToggleTheme: () => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activePage,
  activeWorkCount,
  theme,
  followsSystem = false,
  onSelectPage,
  onToggleTheme,
}) => (
      <aside className="w-16 min-[1280px]:w-56 shrink-0 border-r border-border bg-surface flex flex-col justify-between">
        <div className="px-2 py-4 min-[1280px]:px-3 space-y-6">
          <div className="flex items-center justify-center min-[1280px]:justify-start min-[1280px]:px-1">
            <BrandMark size={28} showWordmark />
          </div>

          <nav aria-label="Primary workspace" className="space-y-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="hidden min-[1280px]:block px-2.5 pb-1.5 label-mono text-label">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((id) => {
                    const item = NAV_ITEMS.find((entry) => entry.id === id);
                    if (!item) return null;
                    const Icon = item.icon;
                    const isActive = activePage === item.id;
                    const badge =
                      item.id === "queue" && activeWorkCount > 0
                        ? activeWorkCount
                        : null;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectPage(item.id)}
                        aria-current={isActive ? "page" : undefined}
                        aria-label={
                          badge
                            ? `${item.label}, ${badge} active`
                            : item.label
                        }
                        title={item.label}
                        className={`relative w-full flex items-center justify-center min-[1280px]:justify-start gap-2.5 h-8 min-[1280px]:px-2.5 rounded-lg text-small font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.98] cursor-pointer ${
                          isActive
                            ? "bg-accent-solid text-accent-fg"
                            : "text-fg-muted hover:text-fg hover:bg-surface-subtle"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="hidden min-[1280px]:inline truncate">
                          {item.label}
                        </span>
                        {badge !== null && (
                          <>
                            <span
                              className={`hidden min-[1280px]:inline-flex ml-auto px-1.5 min-w-5 h-5 items-center justify-center font-mono text-[10px] font-semibold rounded-sm tabular-nums ${
                                isActive
                                  ? "bg-white/20 text-accent-fg"
                                  : "bg-accent-soft text-accent-hover"
                              }`}
                            >
                              {badge}
                            </span>
                            <span
                              className="min-[1280px]:hidden absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-creative"
                              aria-hidden="true"
                            />
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Studio Footer */}
        <div className="p-2 min-[1280px]:p-3 border-t border-border">
          <button
            type="button"
            onClick={() =>
              onToggleTheme()
            }
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            aria-label={`Theme: ${followsSystem ? "system, " : ""}${theme}. Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            className="w-full flex items-center justify-center min-[1280px]:justify-between gap-2 h-8 min-[1280px]:px-2.5 rounded-sm font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted hover:text-fg hover:bg-surface-subtle transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              {theme === "dark" ? (
                <Moon className="w-3.5 h-3.5" />
              ) : (
                <Sun className="w-3.5 h-3.5" />
              )}
              <span className="hidden min-[1280px]:inline">
                {followsSystem ? "System · " : ""}
                {theme === "dark" ? "Dark" : "Light"}
              </span>
            </span>
            <span
              className="hidden min-[1280px]:inline text-[11px] font-semibold text-fg-subtle"
              aria-hidden="true"
            >
              Switch
            </span>
          </button>
        </div>
      </aside>
);
