# Kirea Studio — Apple Design Audit

Audit of `src/renderer` against Apple's interface principles (Designing Fluid Interfaces,
Principles of Great Design, The Details of UI Typography), read in the context of a
Windows desktop app.

**Scope:** renderer only (`App.tsx`, 10 pages, 12 primitives, 3 story components).
**Constraint in force:** the approved direction is *dark, flat, editorial* — no glassmorphism.
Apple's translucency guidance therefore conflicts with standing instructions; conflicts are
flagged, not silently resolved.
**Method:** static read of the renderer plus counts of motion, focus, translucency, and type
tokens. Design proposals live in [UI_SYSTEM_DESIGN.md](./UI_SYSTEM_DESIGN.md); this document
only judges what exists.

---

## Scorecard

Weighted for desktop use — gesture principles are scored as "not applicable" instead of
failing the app for not being touch-first.

| Principle | Grade | One-line verdict |
| --- | --- | --- |
| Responsiveness | **C** | Nothing blocks input, but there is zero press feedback anywhere. |
| Direct manipulation | **n/a** | No draggable surfaces exist; native sliders are the only direct control. |
| Interruptibility / springs | **D** | Zero springs; every transition is a fixed CSS duration on an overlay that cannot be reversed. |
| Spatial consistency | **C+** | Overlays always scale/fade from center; nothing is anchored to its trigger. |
| Materials & depth | **Conflict** | 4 blur surfaces contradict the approved flat system. |
| Feedback & state | **C** | Good badges/toasts/empty states; no skeletons, no press state, no progress honesty. |
| Typography | **D** | 161 instances at ≤11 px, one flat scale, no size-specific tracking. |
| Color & contrast | **C+** | Two WCAG AA failures (muted text, white-on-accent). |
| Reduced motion | **B−** | Global kill-switch exists but deletes feedback instead of substituting it. |
| Wayfinding | **B−** | Strong rail and active states; nested flows lack back/breadcrumb cues. |
| Craft / consistency | **C** | Consistent 1 px flat surfaces, undermined by ad-hoc radii and type sizes. |

---

## 1. Responsiveness — C

**What's right.** No artificial debounce or transition gate sits on the input path. Color
transitions are 150 ms, which reads as instant. Focus moves to the main window correctly after
the splash.

**Violation: no press feedback.** The renderer contains **zero** `:active` states, and zero
pointer handlers. Interactive elements only change on hover, so a click produces no
acknowledgement until the result lands. On a fast machine that is invisible; on a cold model
load it reads as a dead click.

- Evidence: no `:active` / `active:` matches anywhere in `src/renderer`.
- Fix: add a 97% scale + 100 ms ease-out press state to the shared `Button`
  ([Primitives.tsx](../../src/renderer/components/ui/Primitives.tsx)) and to the rail nav
  ([App.tsx:932](../../src/renderer/App.tsx#L932)).
- Cost: ~10 lines, one primitive.

**Minor: no optimistic state.** Queue actions (pause/cancel) wait for IPC round-trip before the
button changes. Acceptable, but the pressed-but-unchanged window is where users double-click.

---

## 2. Direct manipulation — not applicable

No drag surfaces exist: no `onPointerDown`, `setPointerCapture`, `onMouseDown`, or
`draggable` handlers in the renderer. Images are explicitly `draggable={false}`
([BrandMark.tsx:18](../../src/renderer/components/BrandMark.tsx#L18),
[ModelsPage.tsx:172](../../src/renderer/pages/ModelsPage.tsx#L172)).

The one direct control — the native range slider in
[Primitives.tsx](../../src/renderer/components/ui/Primitives.tsx) `SliderField` — is 1:1,
keyboard-accessible, and correct. Leave it native.

This principle returns to relevance only if interaction types are added (canvas node drag,
image reorder, crop handles). If that happens, the rules are: capture the pointer, respect the
grab offset, track a short position/velocity history on `pointermove`.

---

## 3. Interruptibility & springs — D

**Finding.** `framer-motion` is a dependency but is **never imported** in the renderer. All
motion is CSS `transition-*` at fixed durations. That is fine for a hover tint and wrong for
anything a user can dismiss: a modal fading out cannot be re-grabbed, and because the fade
target is `opacity: 0`, the only option is to wait.

The splash cross-fade in `src/main/index.ts` is the exception and the model to follow: it
starts from the live on-screen value, is explicitly time-boxed, and has a fallback close path.

- Scope of the problem: two overlays
  ([ImagePreviewModal.tsx](../../src/renderer/components/ImagePreviewModal.tsx),
  `Modal` in [Primitives.tsx](../../src/renderer/components/ui/Primitives.tsx)).
- Fix: `AnimatePresence` + a spring at `bounce: 0, duration: 0.28` for overlays; enter and exit
  from the same scale/opacity pair so a reversed gesture is continuous.
- Do **not** spring-convert hover states or page mounts — fixed tints are correct there.

---

## 4. Spatial consistency — C+

Overlays mount centered with a fixed scrim. Apple's rule is that a surface originates from what
opened it. For full-screen overlays (the image inspector) that is legitimately the viewport, so
the inspector is acceptable. For anything narrower — a metadata popover, a sampler picker, a
confirm dialog triggered from a row — the center-scaling breaks the spatial link to the
control.

- Evidence: only two overlay types exist today; both are viewport-centered.
- Fix: when small overlays are introduced, set `transform-origin` from the trigger's bounding
  box. Until then, no action.

**Enter/exit asymmetry.** `Modal` and `ImagePreviewModal` have **no enter or exit animation at
all** — they hard-cut in and out (`if (!open) return null`). A hard cut on both ends is at
least consistent, but it is the least expensive thing to improve for perceived polish.

---

## 5. Materials & depth — direct conflict with approved design

Apple's material guidance says floating chrome should be translucent. Your approved system says
flat. Both are present in the codebase, which is the actual defect.

| Location | Surface | Status |
| --- | --- | --- |
| [App.tsx:950](../../src/renderer/App.tsx#L950) | header `bg-surface/80 backdrop-blur-xs` | Approved direction says flat |
| [ImagePreviewModal.tsx:162](../../src/renderer/components/ImagePreviewModal.tsx#L162) | scrim `bg-black/80 backdrop-blur-sm` | Heavy blur over the whole viewport |
| [Primitives.tsx:200](../../src/renderer/components/ui/Primitives.tsx#L200) | scrim `bg-black/70 backdrop-blur-xs` | Inconsistent with the inspector scrim above |
| [ModelPreview.tsx:77](../../src/renderer/components/ModelPreview.tsx#L77), [ModelsPage.tsx:158](../../src/renderer/pages/ModelsPage.tsx#L158) | `bg-bg/70` | No blur, just alpha |

**Recommendation.** Stay flat — it is the approved system, it matches the splash, and it is
cheaper on integrated GPUs. Concretely:
- Header → solid `--surface` with a 1 px `--border` bottom edge. Content scrolls beneath it,
  so no translucency is needed to signal the layer.
- Scrims → one value, `bg-black/72`, **no blur**, shared by both overlays. Blur on a full-screen
  scrim costs a real composite pass for no informational gain.
- `bg-bg/70` on model previews is fine (alpha over media, not chrome) — but standardize it.

If you instead want the Apple reading of the header, it must be approved explicitly and then
applied consistently to the rail too — a translucent header over an opaque rail is the one
combination Apple rules out. Do not do half.

---

## 6. Feedback & state — C

**Right.** Semantic status colors on badges, `aria-live="polite"` on the toast region
([App.tsx:1416](../../src/renderer/App.tsx#L1416)), disabled+loading states on `Button`,
genuinely useful `EmptyState` components, and count badges on the queue rail item.

**Gaps.**

1. **No skeletons.** Long lists (models, library, explore) render empty then pop. Every
   `animate-pulse` in the codebase is on a decorative icon or status dot, not on placeholder
   content. One `Skeleton` primitive used in the three grid pages is the highest-value feedback
   fix in the app.
2. **`transition-all` on progress bars** — 8 occurrences
   ([CreatePage.tsx:2587](../../src/renderer/pages/CreatePage.tsx#L2587),
   [QueuePage.tsx:128](../../src/renderer/pages/QueuePage.tsx#L128),
   [QueuePage.tsx:278](../../src/renderer/pages/QueuePage.tsx#L278),
   [ModelsPage.tsx:952](../../src/renderer/pages/ModelsPage.tsx#L952),
   [ModelsPage.tsx:1392](../../src/renderer/pages/ModelsPage.tsx#L1392),
   [SettingsPage.tsx:383](../../src/renderer/pages/SettingsPage.tsx#L383)) animate layout and
   paint, not just width. Change to `transition-[width]` — same visual, correct compositing.
   Cards with `transition-all`
   ([HomePage.tsx:267](../../src/renderer/pages/HomePage.tsx#L267),
   [LibraryPage.tsx:210](../../src/renderer/pages/LibraryPage.tsx#L210)) should be
   `transition-colors`.
3. **Progress bars animate linearly with no easing change at completion**, so a job that
   finishes at 97% snaps the last 3% at the same speed. Minor, but it is the difference between
   a bar and a meter.

---

## 7. Typography — D

This is the weakest area and the one the design doc already addresses.

- **161 instances at ≤11 px**: 30× `text-[10px]`, 127× `text-[11px]`, plus `text-[6px]`,
  `[8px]`, `[9px]`. Distribution: ModelsPage 35, CreatePage 46, StoryCanvasWorkspace 20,
  ExplorePage 15, StoryStudioPage 13. Sub-12 px text on a 1440×920 display is below the
  comfortable reading floor for body content; it is only acceptable for dense tabular data at
  full contrast.
- **Arbitrary sizes instead of a scale.** Sizes are chosen per site, so `13px` and `12px` and
  `11px` all appear for the same semantic role in different pages.
- **Tracking is inverted.** 21× `tracking-wider` — used mostly on 10–11 px labels where the
  extra space helps — alongside 3× `tracking-tight` on headings. That is directionally
  correct, but it is applied by hand per element rather than derived from size.
- **Hierarchy comes from size alone.** Headings and body share weight; nothing uses 600/700 to
  create rank without consuming vertical space.
- **One family for everything.** Segoe UI everywhere, including numeric telemetry where
  tabular figures and a mono face would prevent column jitter. `tabular-nums` is defined in
  [index.css](../../src/renderer/index.css) and used, which is good and should stay.

Proposals (exact scale, tracking per size, Cascadia Mono for data) are in
[UI_SYSTEM_DESIGN.md](./UI_SYSTEM_DESIGN.md). The audit's only insistence: **stop adding new
`text-[Npx]` values**; route through the scale.

---

## 8. Color & contrast — C+

Two concrete WCAG 2.2 AA failures, both already scoped in the design doc:

| Token / usage | Ratio | Verdict |
| --- | --- | --- |
| `--fg-subtle #66758F` on `--bg #0B0E14` | 4.14:1 | Fails AA (4.5:1). Proposed `#74839C` → 5.03:1 |
| white on `--accent #3B82F6` (filled buttons) | 3.68:1 | Fails AA. Proposed filled-button token `#2563EB` → 5.17:1 |

Everything else in the palette clears AA, including `--fg-muted #93A1B8` at 7.4:1. Semantic
tones (success/warning/danger) are used consistently for status only, never decoration — keep
that.

One structural note: the accent is currently asked to do two jobs (text/icon color and fill
color). Splitting it into `--accent` (5.3:1 on surface, for text) and `--accent-solid`
(for fills) is the fix; see the design doc.

---

## 9. Reduced motion — B−

[index.css](../../src/renderer/index.css) sets animation and transition durations to 0.01 ms
under `prefers-reduced-motion: reduce`. That prevents vestibular harm, which is the main goal —
but it also removes *all* feedback, including the harmless opacity changes that aid
comprehension. Apple's guidance is substitution, not deletion.

- Fix: exclude color and opacity from the kill switch; keep duration removal for transform,
  scale, and slide. Modal enter/exit becomes a 120 ms pure cross-fade instead of nothing.
- Also add `prefers-reduced-transparency: reduce` handling when the blur decision in §5 is
  settled — if the header stays translucent, this query must make it solid.

---

## 10. Wayfinding — B−

**Right.** Fixed rail with a persistent active state and `aria-current="page"`
([App.tsx:895](../../src/renderer/App.tsx#L895)); the queue badge surfaces pending work from
anywhere; the header carries engine status and a persistent route back to Studio; page titles
are consistent through `SectionHeader`.

**Gaps.**

1. **Page headers scroll away.** No `sticky` is used anywhere in the renderer, so on the long
   pages (Create, Models, Settings) the title and primary actions leave the viewport. This is
   the largest wayfinding defect after typography.
2. **Nested flows lack a back affordance.** Story → canvas is a two-level descent with no
   visible breadcrumb or back button; returning depends on the rail, which is a sibling, not an
   ancestor.
3. **Rail grouping is flat.** Ten items in one list means Home and Settings carry the same
   weight. Grouping into WORKSPACE / STUDIO / SYSTEM (per the design doc) costs nothing and
   conveys structure.

---

## 11. Craft & consistency — C

**Right.** 1 px borders, flat non-shadowed surfaces, one radius language, native scrollbar
styling, `focus-visible` rings on the shared primitives.

**Inconsistencies.**

1. **Focus coverage is 11 instances across 6 of 16 files.** CharactersPage, CreatePage,
   ExplorePage, ModelsPage, QueuePage and SettingsPage contain **no** `focus-visible` styling
   at all; raw `<button>`s there show the browser default or nothing. The theme toggle
   ([App.tsx:932](../../src/renderer/App.tsx#L932)) has none. Keyboard users hit dead ends.
2. **Radius sprawl.** `rounded-lg`, `rounded-xl`, `rounded-2xl` and `rounded-full` are chosen
   freely; there is no rule for container vs control. Fix: controls 8 px, containers 12 px,
   overlays 16 px, pills only for badges.
3. **z-index**. Overlays use `z-50` ad hoc with no scale; the first popover will collide.
4. **No focus trap, focus restore, or scroll lock** in either dialog
   ([Primitives.tsx](../../src/renderer/components/ui/Primitives.tsx),
   [ImagePreviewModal.tsx](../../src/renderer/components/ImagePreviewModal.tsx)). Escape works
   in both; Tab walks out of the dialog into the page behind it. For a modal marking itself
   `aria-modal="true"`, that is an accessibility bug, not a polish item.

---

## Prioritized fixes

**P0 — accessibility and correctness (do regardless of redesign approval)**

1. Focus trap + focus restore + background scroll lock in both dialogs.
2. `focus-visible` ring on every interactive element (lift from `Button`, apply to raw
   buttons; start with the theme toggle and rail footer).
3. Fix the two contrast failures (`--fg-subtle`, filled-button accent).
4. Replace `transition-all` on progress bars with `transition-[width]`.

**P1 — perceived quality (low risk, contained)**

5. Press state (`:active` scale) on `Button` and rail items.
6. One shared scrim value, no blur; solid header — resolves the flat-vs-material conflict.
7. `Skeleton` primitive for the three grid pages.
8. Sticky page header/toolbar on long pages.
9. Reduced-motion substitution for color/opacity instead of the global kill switch.

**P2 — system work (belongs with the redesign)**

10. Type scale adoption; retire new `text-[Npx]` values.
11. Rail grouping, radius/z-index scale.
12. Spring-based overlay enter/exit; delete `framer-motion` if that does not happen.

---

## Already correct — do not change

- Splash cross-fade in `src/main/index.ts` (live-value fade, bounded, fallback close).
- 150 ms color-only hover transitions on controls.
- Semantic-only use of success/warning/danger.
- Native range sliders — 1:1, keyboard-accessible, zero custom-drag risk.
- `aria-live` toast region and `aria-current` rail state.
- `tabular-nums` on all numeric telemetry.
