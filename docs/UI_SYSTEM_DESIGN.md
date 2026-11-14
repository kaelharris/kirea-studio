# Kirea Studio — UI Design System

Scope: **colors · structure · typography** · Status: draft for approval · 2026-11-12
Constraint: dark, flat, editorial. Renderer only — no backend, IPC, schema or ComfyUI changes. No UI code until approved.

---

## 1. Color

### 1.1 Principles

1. **Layered neutrals, one accent.** Depth comes from four surface steps and 1 px borders — not shadows, not gradients.
2. **Blue means action.** Accent marks primary actions, active navigation and focus. Nothing decorative uses it.
3. **Colour never carries meaning alone.** Status = dot + word; selection = border + fill; errors = icon + text.
4. **Dark is canonical.** The light theme mirrors the same roles with the same hierarchy.

### 1.2 Surface ladder (dark)

| Step | Token | Hex | Used for |
|---|---|---|---|
| 0 | `--bg` | `#0B0E14` | Window canvas, inputs, recessed areas |
| 1 | `--surface` | `#111622` | Left rail, top bar, cards |
| 2 | `--surface-elevated` | `#171D2C` | Popovers, modal header, menus |
| 3 | `--surface-subtle` | `#1C2436` | Hover fills, segmented control track |
| Line | `--border` | `#252F44` | Every structural divider |
| Line+ | `--border-strong` | `#34425F` | Emphasized edges, selected outline, scrollbar |

### 1.3 Text and accent

| Token | Hex | Contrast on `--bg` | Use |
|---|---|---|---|
| `--fg` | `#EEF2F9` | 17.2:1 | Headings, primary text |
| `--fg-muted` | `#93A1B8` | 7.4:1 | Secondary text, labels, inactive nav |
| `--fg-subtle` | `#74839C` | 5.0:1 | Captions, metadata, placeholders (was `#66758F` at 4.1:1 — fails AA) |
| `--accent` | `#3B82F6` | 5.3:1 | Links, icons, active indicators, focus ring |
| `--accent-solid` | `#2563EB` | white text 5.2:1 | **Filled primary buttons** (current white-on-#3B82F6 was 3.7:1 — fails AA) |
| `--accent-solid-hover` | `#1D4ED8` | white text 6.7:1 | Primary hover/pressed |
| `--accent-soft` | `rgba(59,130,246,.14)` | — | Selected rows, soft badges |
| `--brand` | `#1E3BFF` | — | **Splash art, icon, brand moments only — never UI controls** |

### 1.4 Semantic tones

| Role | Solid | Soft fill | Use |
|---|---|---|---|
| Success | `#10B981` | 14% | Connected runtime, completed jobs |
| Warning | `#F59E0B` | 14% | Disconnected runtime, missing model |
| Danger | `#EF4444` | 14% | Destructive actions, failed jobs |
| Info | `#06B6D4` | 14% | Local-only / privacy notes, tips |

### 1.5 Overlays and focus

- Scrim `--overlay`: `rgba(5,7,12,.72)` for modals and drawers.
- Focus ring: 2 px `--accent`, 2 px offset — on every interactive element.
- Selected card/row: `--border-strong` outline + `--accent-soft` fill.
- Light theme: keep the existing `html[data-theme="light"]` values; roles stay identical.

### 1.6 Colour rules

- At most one soft gradient in the whole app: the Home hero. Every other surface is flat.
- No coloured glows, no tinted shadows, no translucent panels.
- Images sit on `--bg`, never on a coloured backdrop.
- Never place `--fg-subtle` on `--surface-subtle`; step up to `--fg-muted` there.

---

## 2. Structure

### 2.1 Window frame

```
┌ Windows title bar (native, untouched) ───────────────────────┐
├ 52 px status bar ────────────────────────────────────────────┤
│ GPU · VRAM │ ComfyUI status · Start Engine │ Studio           │
├ 240 px rail ─┬ main viewport (24 px padding) ────────────────┤
│ brand        │ PageHeader: title · meta · actions             │
│ WORKSPACE    │ ─────────────────────────────────────────────  │
│  Home        │                                                │
│  Create      │ content template                                │
│  Explore     │                                                │
│  Library     │                                                │
│ STUDIO       │                                                │
│  Characters  │                                                │
│  Stories     │                                                │
│  Models      │                                                │
│  Workflows   │                                                │
│ SYSTEM       │                                                │
│  Queue  [n]  │                                                │
│  Settings    │                                                │
│ theme toggle │                                                │
└──────────────┴────────────────────────────────────────────────┘
```

- Rail: 240 px ≥1280 px wide, 64 px icon-only with tooltips at 1080–1279 px. Groups are separated by a 10 px uppercase label and 12 px gap.
- Top bar is the only persistent status surface: hardware, runtime state, Start Engine, and a contextual Studio/New action. Page-specific actions live in the page header.
- Content scrolls; rail and top bar are fixed. Page padding 24 px, section gap 24 px, card padding 16 px.

### 2.2 Vertical rhythm and controls

| Token | Value |
|---|---|
| Space scale | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 |
| Control height | 32 secondary · 36 primary · 28 compact |
| Radius | 6 input · 8 button · 12 card · 16 panel/modal · full chip |
| Card gap | 16 (dense) / 20 (default) |
| Page header height | title 26 + meta 18 + 20 padding, border-bottom 1 px |
| Z-index | content 0 · sticky 10 · drawer 20 · popover 30 · modal 40 · toast 50 |

### 2.3 Page templates

**T1 Dashboard — Home.** Hero (single gradient), 4 stat tiles, recent images strip, presets grid.
**T2 Browse — Explore, Library, Models, Characters, Stories.** Sticky toolbar (search · filter · sort · view) + responsive grid; selection bar appears when items are selected.
**T3 Workbench — Create, Story Studio, Canvas.** Left controls 320 px, center canvas flexible, right inspector 280 px; left/right collapse independently; center never scrolls sideways.
**T4 Manager — Queue, Workflows, Settings.** Header + toolbar + list; Settings uses 200 px section nav and a 720 px form column.
**T5 Inspector — image preview, model/character detail.** Overlay at z-40 with metadata rail beside the artwork.

Workbench:

```
┌ PageHeader: Create · [txt2img|img2img] · [Generate] ┐
├ 320 controls ──┬ result canvas ─────────┬ 280 inspector ┤
│ prompt        │                          │ queue         │
│ negative      │   image / empty state    │ outputs       │
│ model / LoRA  │                          │ presets       │
│ size / steps  │   compare · batch strip  │ history       │
│ advanced ▾    │                          │               │
└───────────────┴──────────────────────────┴───────────────┘
```

### 2.4 Grid behaviour

| Width | Rail | Card grid | Workbench |
|---|---|---|---|
| 1080–1279 | 64 icon rail | 2–3 cols | inspector collapses to tabs |
| 1280–1599 | 240 rail | 3–4 cols | three zones |
| ≥1600 | 240 rail | 4–6 cols | three zones, content capped at 1600 px |

### 2.5 Structural rules

- One H1 per page, inside the PageHeader. Cards use H3.
- Primary action sits top-right of the page header; destructive actions live in overflow menus, never next to primary.
- No nested cards. Use section dividers inside a card.
- Toolbars stick under the top bar; they never float over content.
- Empty states are designed, centred, with one action.

---

## 3. Typography

### 3.1 Family

| Role | Family | Why |
|---|---|---|
| UI | `"Segoe UI Variable Text", "Segoe UI", "Inter", system-ui, sans-serif` | Native to Windows, zero download, crisp at 11–14 px, matches the flat editorial tone |
| Data | `"Cascadia Mono", Consolas, "Courier New", monospace` | Seeds, hashes, dimensions, file paths |

No bundled font in the UI. The splash keeps its Bodoni wordmark as the only serif moment; the app itself stays sans so the two never compete. (Cinzel stays rejected.)

### 3.2 Scale

| Role | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| Display | 28 / 34 | 700 | -0.02em | Home hero only |
| H1 | 20 / 26 | 700 | -0.01em | Page title |
| H2 | 16 / 22 | 600 | 0 | Section / modal title |
| H3 | 14 / 20 | 600 | 0 | Card title |
| Body | 14 / 20 | 400 | 0 | Default text |
| Small | 13 / 18 | 400 | 0 | Helper text, table cells |
| Caption | 11 / 16 | 600 | 0.06em uppercase | Group labels, badges, meta |
| Mono | 11 / 16 | 400 | 0 | Seed, size, IDs |

Only three weights exist: 400, 600, 700. Readouts use tabular numerals.

### 3.3 Typography rules

- Sentence case everywhere; uppercase only for 11 px caption labels and badges.
- Body measure capped at 68 characters; form column 720 px max.
- Numbers in tables, sliders and metadata are tabular and right-aligned when compared.
- Truncate with ellipsis on one line; never wrap button labels.
- Focus is communicated by the ring, not by bolder text.

### 3.4 Where the three systems meet

| Surface | Colour | Structure | Type |
|---|---|---|---|
| Home | Hero gradient + 4 stat tiles | T1 | Display + H3 + caption |
| Create | Controls on surface, canvas on bg | T3 | H1 + body 13/14 + mono readouts |
| Library | Tiles on bg, no card chrome | T2 | H1 + caption meta, tabular counts |
| Models | Table or grid toggle | T2/T4 | H2 rows + mono file size |
| Settings | Section nav + form column | T4 | H2 sections + form labels |

---

## 4. Decisions requested

1. **Accent** — split `--accent` (#3B82F6, text/focus) from `--accent-solid` (#2563EB, filled buttons) — recommended; the current pair fails AA. Alternative: unify on brand #1E3BFF.
2. **Rail** — grouped 240 px rail that collapses to icons below 1280 px — recommended. Alternatives: always-icon rail, top tabs.
3. **Font** — system Segoe UI + Cascadia Mono, no bundled fonts — recommended. Alternative: add a serif display for page titles.
4. **Light theme** — keep functional parity (recommended) or freeze dark-only during the redesign.
