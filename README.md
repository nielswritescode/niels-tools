# Niels' Tools

A small static site of personal tools, hosted on GitHub Pages.

## Structure

- `index.html` / `styles.css` — home page listing all tools.
- `tools/<tool-name>/` — one folder per tool, each a self-contained static page.

## Adding a new tool

1. Create `tools/<tool-name>/` with its own `index.html` (link back to `../../styles.css` for shared styling).
2. Add a card linking to it in the root `index.html`.

## Tools

- **Practice Timer** (`tools/practice-timer/`) — simple or multi-round countdown timer with custom sounds, volume, and durations (minutes or seconds). Settings persist in `localStorage`.
