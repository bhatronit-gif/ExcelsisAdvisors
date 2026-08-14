# Project: ExcelsisAdvisors Web Audit Portal Refactoring & Improvement

## Architecture & Code Layout
- Target Root: `/Users/ronit/Downloads/ExcelsisAdvisors-main`
- Core HTML: `index.html`
- External Stylesheets: `css/styles.css`
- External JS Modules: `js/config.js`, `js/storage.js`, `js/state.js`, `js/auth.js`, `js/ui.js`, `js/export.js`, `js/reports.js`, `js/ai.js`, `js/app.js`
- Assets: `favicon.png`, `logo.webp`, `site.webmanifest`
- Reports: `AUDIT_REPORT.md`

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Audit Report Documentation | Create comprehensive AUDIT_REPORT.md with categorized findings | M0 | ORIGINAL_REQUEST R1 |
| 2 | HTML Semantic Structure | Fix document title, <h1> tag, skip-to-main link, and landmark roles | M1 | Survey Explorer 1 (H1, M2, M3, M4) |
| 3 | Form Accessibility & Labels | Add <form> containers, <label for> associations to card textareas & inputs | M1 | Survey Explorer 1 (H2, H3) |
| 4 | Accessible Modals & Dialogs | Implement role="dialog", aria-modal, focus trapping, Escape key handlers | M1 | Survey Explorer 1 (H4) |
| 5 | Accessible Names & Ratings | Add aria-labels to icon buttons, radio group semantics to rating 1-5 buttons | M1 | Survey Explorer 1 (H5, M5) |
| 6 | WCAG Contrast & Font Scaling | Fix low contrast slate colors and bump sub-12px micro typography | M1 | Survey Explorer 1 (H6, M6, M7) |
| 7 | CSS Modularization & Variables | Extract embedded CSS to css/styles.css, add CSS custom properties | M2 | Survey Explorer 2 (CSS-1, CSS-3) |
| 8 | Tailwind CDN & Utilities Fix | Fix bg-slate-955 to bg-slate-950, replace/optimize Tailwind setup | M2 | Survey Explorer 2 (CSS-2, CSS-4, CSS-5) |
| 9 | Mobile Layout & Responsiveness | Convert top mobile sidebar to collapsible header drawer, fix modal scroll | M2 | Survey Explorer 2 (MOB-1, MOB-2, MOB-3, MOB-4) |
| 10| UI Polish & Surface Harmonization| Harmonize dark mode surface hexes, optimize ambient blur animations | M2 | Survey Explorer 2 (UI-1, UI-2, UI-3, UI-4, UI-5) |
| 11| JS Modularization & Defer | Modularize 2,466 lines inline JS into /js modules with defer imports | M3 | Survey Explorer 3 (H2, M4) |
| 12| Debounced Storage & State | Implement debounced saveState() on textarea input to eliminate UI lag | M3 | Survey Explorer 3 (H1) |
| 13| DOM Filter Optimization | Replace total grid innerHTML teardown with element visibility toggles | M3 | Survey Explorer 3 (M1) |
| 14| SEO, OpenGraph & JSON-LD | Add Canonical, OG, Twitter Cards, Robots, Theme-color & Schema.org JSON-LD | M3 | Survey Explorer 3 (M2, M3) |
| 15| Asset Verification & Security | Verify favicon portfolio, clean auth logic, validate links & HTML5 syntax | M3 | Survey Explorer 3 (H4, L1, L2, L3) |
| 16| AI Executive Summaries | Google Gemini API integration (`gemini-2.5-flash`), interactive modal & PDF report synthesis | M4 | GRILL_ME SPEC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M0 | Audit Report & Setup | Create AUDIT_REPORT.md and PROJECT.md at root | none | DONE |
| M1 | HTML Structure & WCAG | Fix HTML semantics, WCAG accessibility, form labels, ARIA dialogs | M0 | DONE |
| M2 | CSS & Mobile Polish | Modularize CSS, custom properties, mobile responsive drawer & modal scroll | M1 | DONE |
| M3 | JS Performance & SEO | JS modularization, debounced storage, DOM filter optimization, SEO metadata | M2 | DONE |
| M4 | AI Executive Summaries | Gemini client, UI modal, markdown editor, IndexedDB persistence & PDF report synthesis | M3 | DONE |

## Interface Contracts
### HTML ↔ CSS
- `index.html` links `<link rel="stylesheet" href="css/styles.css">`.
- CSS custom properties defined in `:root` and `.dark`.

### HTML ↔ JS
- Modular JS loaded via `<script type="module" src="js/app.js"></script>`.
- Storage debounced via `debounce(saveState, 400)`.
- Event listeners attached dynamically or cleanly bound to window handlers.
- AI state persisted in `state.aiSummary` and rendered via `renderMarkdown()`.
