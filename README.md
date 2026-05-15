# URL Field Extension

A Contentstack custom field extension that provides a validated URL input and keeps an out-of-the-box (OOB) URL field in the same entry in sync.

## How it works

The extension renders a single text input inside a Contentstack entry. As the editor types, every keystroke is validated and the value is written both to the extension's own field and to a nominated OOB field in the same entry. If a write can't complete in time (e.g. a slow SDK round-trip), a final sync is guaranteed on focus loss (blur).

A small status indicator below the input shows the sync state: syncing, synced, or failed.

### Bidirectional sync

Changes made to the OOB field from outside the extension (API writes, imports, other extensions) are reflected back in the extension input in real time via `field.onChange()`.

### Validation order

Each keystroke runs three checks in sequence. A later check only runs if the earlier one passes.

1. **Format** — either a config-supplied regex *or* the built-in absolute-URL check (requires `http://`, `https://`, or `ftp://` and a valid hostname). If `validation_regex` is set it fully replaces the built-in check, allowing relative paths, custom schemes, or any other format.
2. **Forbidden words** — if `forbidden_words` is set, the value is scanned (case-insensitively) for each word. The first match blocks the value and names the offending word in the error message.

While the input is invalid the value is still synced to both fields so editors can see work-in-progress. Contentstack's own publish guards prevent invalid content from going live.

---

## Setup

### 1. Install and run

```bash
npm install
npm run dev      # development server on http://localhost:5173
npm run build    # production build → dist/
```

Expose the dev server with a tunnel tool (e.g. ngrok) or deploy `dist/` to any static host.

### 2. Register the extension in Contentstack

1. Go to **Settings → Extensions → Add extension → Custom field**.
2. Set the hosted URL (ngrok URL for dev, static host URL for production).
3. Set **Data type** to match the OOB field you want to sync to (typically *Text*).

### 3. Configure the extension

In the extension's **Config** tab supply a JSON object. All keys are optional.

| Key | Type | Description |
|---|---|---|
| `target_field_uid` | string | UID of the OOB field to keep in sync. |
| `validation_regex` | string | Regex the value must match. Replaces the built-in URL check entirely when set. |
| `validation_message` | string | Error message shown when `validation_regex` does not match. |
| `forbidden_words` | string[] | Words (case-insensitive) that must not appear anywhere in the value. |

#### Example — relative paths, synced to an OOB field, with forbidden words

```json
{
  "target_field_uid": "url",
  "validation_regex": "^\\/([a-z0-9-]+\\/)*[a-z0-9-]+\\/?$",
  "validation_message": "Must be a lowercase slug path starting with /",
  "forbidden_words": ["admin", "login", "wp-admin"]
}
```

#### Example — absolute URLs restricted to one domain

```json
{
  "target_field_uid": "canonical_url",
  "validation_regex": "^https://example\\.com",
  "validation_message": "Only https://example.com URLs are allowed"
}
```

#### Example — standard absolute URL validation, no OOB sync

```json
{}
```

### 4. Add the extension to a content type

Open a content type, add a **Custom** field, and select this extension. The field label and whether it is required are controlled by the content type schema as normal.

---

## Development notes

- **Tech stack:** Vite + TypeScript, no UI framework.
- **SDK:** [`@contentstack/app-sdk`](https://www.npmjs.com/package/@contentstack/app-sdk).
- When loaded outside Contentstack (plain browser tab) the SDK init fails gracefully and the input still renders with full validation — useful for styling and regex testing during development.
- The iframe auto-resizes to content height via `frame.enableAutoResizing()`.
