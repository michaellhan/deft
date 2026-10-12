# Deft Rewrite

A minimal page that rewrites AI-generated text with [Deft](https://deftwriting.com).

Live at **[michael-han.com/deft](https://michael-han.com/deft/)**.

## How it works

- `index.html`, `style.css`, `app.js`: the static page, served by GitHub Pages.
- `worker/`: a Cloudflare Worker on `michael-han.com/deft/api/*` that holds the Deft API key and forwards requests to `POST https://deftwriting.com/v1/generate` with:

```json
{
  "generationMode": "rewrite",
  "prompt": "<the pasted text>",
  "thinkingLevel": "faster",
  "optimizeFor": "human"
}
```

The page lets visitors switch `thinkingLevel` (faster / smarter) and `optimizeFor` (human / polished). The worker caps input at 20,000 characters, only accepts requests from michael-han.com (and localhost), and rate limits each IP to 5 requests per minute.

## Deploy the worker

```bash
cd worker
npx wrangler secret put DEFT_API_KEY
npx wrangler deploy
```

## Run the page locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Locally the page calls the deployed worker.
