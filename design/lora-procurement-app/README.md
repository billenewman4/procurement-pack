# Lora Procurement App — design source

Imported 2026-08-06 from the Claude Design project
"Cofactr procurement UI mockups"
(`claude.ai/design/p/90cb732d-7dad-409b-94a7-feb4ae425450`,
file `Lora Procurement App.dc.html`).

This is the source of truth for the LORA procurement dashboard that the
bom-dashboard skill publishes. The skill's
`skills/bom-dashboard/assets/template.html` is built FROM these files —
change the look here, then rebuild the template; never restyle in the
skill or at render time.

Files:

- `Lora Procurement App.dc.html` — the full five-screen mockup
  (Parts / BOMs / Cart / RFQs / Orders). A `.dc.html` design-container
  template: `{{ }}` bindings hydrated by `support.js`; not directly
  renderable as a static page.
- `_ds/styles.css` — the Industry design-system tokens and component
  classes (Barlow / Barlow Condensed, blueprint corner marks, square
  chrome, steel-blue accent `#5980a6`). Its Google Fonts `@import` does
  not work in artifacts (network blocked) — that's what `fonts.css`
  is for.
- `fonts.css` + `fonts/*.woff2` — Barlow 400/500/700 and Barlow
  Condensed 400/600 (latin, latin-ext, vietnamese subsets, 15 files,
  ~144KB), extracted from the design's bundled export. `fonts.css`
  embeds them as `data:` URIs so artifacts are self-contained (artifact
  CSP allows `font-src data:`).
- `support.js` — the dc-runtime (generated; renders the template with
  React). Reference only — the artifact template uses its own small
  vanilla-JS renderer instead.

Weight conventions in the design worth knowing: headings and buttons are
Barlow Condensed 600; part numbers and money values are Barlow
Condensed 400; body text is Barlow 400.

The upstream `_ds_bundle.js` is an empty namespace shell (no JS
components) and was not vendored.
