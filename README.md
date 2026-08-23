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
- **Common Clipboard** (`tools/common-clipboard/`) — a grid of text snippets and bright-colored category labels; click a square to copy it, right-click to edit or delete it. Persists in `localStorage`.
- **Group Mailer** (`tools/group-mailer/`) — add contacts, organize them into groups, and send a title/content email to a group. Needs a local backend (see below) since sending real mail requires an SMTP password that can't live in this public repo/site.

### Running Group Mailer

This is the one tool here that isn't purely static — it sends real email, so the SMTP password has to stay off the public site. A small local Python server holds the credentials and talks SMTP; the page in your browser (whether opened locally or via the hosted GitHub Pages URL) just calls that local server.

1. Create a `secrets.env` file in the project root (already gitignored) with:
   ```
   SMTP_USER=you@example.com
   SMTP_PASS=your-app-password
   SMTP_HOST=smtp.protonmail.ch
   SMTP_PORT=587
   ```
2. Run the server: `python3 tools/group-mailer/server.py` (stdlib only, no install needed).
3. Open `tools/group-mailer/index.html` (or the hosted page) while the server is running.

Contacts and groups are stored in `tools/group-mailer/data.json`, which is also gitignored.
