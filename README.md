# Microburbs Sandbox — Suburb Explorer

A minimal, modern vanilla-JS dashboard for exploring Microburbs sandbox and API endpoints for a given suburb.  
This repository provides a lightweight UI (index.html + styles.css + app.js) and a recommended Cloudflare Worker pattern to proxy requests to Microburbs (to avoid CORS and to add the Authorization header server-side).

This README explains:
- What the project does
- File layout and what each file is responsible for
- Step-by-step Cloudflare Worker setup (copy/paste ready)
- How to configure and run the frontend
- Alternatives (local Flask proxy, Vercel Edge)
- Troubleshooting and security notes

---

## Quick overview

- The frontend lets you select a Microburbs endpoint (amenity, demographics, ethnicity, etc.) and a suburb name, then fetches and visualises the returned JSON: summary cards, a simple numeric bar chart and a table.
- Because the Microburbs API blocks cross-origin requests with Authorization headers, we run a tiny server-side proxy (Cloudflare Worker is recommended) that:
  - Adds `Authorization: Bearer test` to upstream requests when needed
  - Returns appropriate CORS headers so the browser can call the proxy without preflight issues
- You host the UI (GitHub Pages, Cloudflare Pages, Netlify, or local server) and point the frontend to the Worker URL.

---

## Repo file layout

- `index.html` — UI shell and app container.
- `styles.css` — Minimal modern styling for the dashboard.
- `app.js` — Main client logic (builds request URL, fetches data, renders summary/table/chart). Configure `PROXY_BASE` and `PATH_PREFIX` here.
- `README.md` — (this file).
- (Optional) other assets you place into the repo when you want to host the UI statically.

---

## Prerequisites

- A Cloudflare account (free tier is fine) to run the Worker proxy.
- A static hosting place for the UI (GitHub Pages, Cloudflare Pages, Netlify) or any local webserver for development.
- Basic command-line tools for testing (curl) or PowerShell (use `curl.exe` on Windows to avoid the alias issue).

---

## Cloudflare Worker setup (recommended, quick)

This Worker will:
- Serve a small status page at `/`
- Proxy requests under `/suburb/<endpoint>` and `/sandbox/suburb/<endpoint>` to Microburbs
- Add `Authorization: Bearer test` for non-sandbox upstream calls
- Add `Access-Control-Allow-Origin: *` so your frontend can call it without CORS errors

1. Log into Cloudflare and go to **Workers & Pages** (or click **Start building** on the dashboard).
2. Create a new Worker (give it a name like `mb-proxy`).
3. In the Quick Editor, replace the default worker code with the code below and click **Save and Deploy**.

Worker code (copy-paste):

```javascript
// Cloudflare Worker: proxy for Microburbs API (status page + /suburb and /sandbox/suburb proxy)
export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname; // e.g. /suburb/amenity or /sandbox/suburb/amenity

    // Root status page
    if (path === "/" || path === "") {
      const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>mb-proxy status</title></head>
<body style="font-family: system-ui, Arial; padding:28px;">
  <h2>mb-proxy Worker</h2>
  <p>Worker is deployed. Use the proxy endpoints:</p>
  <ul>
    <li><code>/suburb/&lt;endpoint&gt;?suburb=Belmont%20North</code> — calls live API (adds Authorization)</li>
    <li><code>/sandbox/suburb/&lt;endpoint&gt;?suburb=Belmont%20North</code> — calls sandbox API</li>
  </ul>
  <p>Example: <a href="${url.origin}/suburb/amenity?suburb=Belmont%20North">${url.origin}/suburb/amenity?suburb=Belmont%20North</a></p>
</body></html>`;
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...cors } });
    }

    // Only allowed paths
    if (!path.startsWith("/suburb/") && !path.startsWith("/sandbox/suburb/")) {
      return new Response("Allowed paths: /suburb/* or /sandbox/suburb/*", { status: 400, headers: cors });
    }

    // Compose upstream
    const upstreamBase = "https://www.microburbs.com.au/report_generator/api";
    const upstream = upstreamBase + path + url.search;

    // Set headers for upstream: Authorization only for non-sandbox paths
    const headers = { "Content-Type": "application/json" };
    if (!path.startsWith("/sandbox/")) {
      headers["Authorization"] = "Bearer test"; // token is kept server-side
    }

    try {
      const upstreamRes = await fetch(upstream, { method: "GET", headers });
      const body = await upstreamRes.arrayBuffer();
      return new Response(body, {
        status: upstreamRes.status,
        headers: {
          ...cors,
          "Content-Type": upstreamRes.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
    }
  }
};
```

4. After deploy you'll get a URL like:
```
https://mb-proxy-<yourname>.workers.dev/
```
Visit that root URL — you should see the worker status page. If you see the status HTML, the worker is live.

5. Test an endpoint (replace the worker host with your own):
```
curl -i "https://mb-proxy-<yourname>.workers.dev/suburb/amenity?suburb=Belmont%20North"
```
You should receive JSON (or an upstream error code). If you receive JSON, the proxy is functioning.

---

## Configure the frontend (app.js)

Open `app.js` and change the top configuration values to point at your Worker:

```javascript
// app.js – top of file
const USE_PROXY = true;
const PROXY_BASE = "https://mb-proxy-<yourname>.workers.dev"; // replace with your Worker URL
const PATH_PREFIX = "suburb"; // or "sandbox/suburb" if you prefer sandbox upstream
```

How it works:
- If `USE_PROXY` is true and `PROXY_BASE` defined, `app.js` will build URLs like:
  - `${PROXY_BASE}/suburb/amenity?suburb=Belmont%20North` (this routes to the worker which calls the live API and adds Authorization)
  - or `${PROXY_BASE}/sandbox/suburb/amenity?suburb=Belmont%20North` (this routes to the sandbox upstream via the worker)
- The frontend does NOT send `Authorization` or `Content-Type` headers itself — the Worker adds the token upstream and returns CORS headers to the browser.

---

## Run frontend locally (development)

1. Put `index.html`, `styles.css`, and `app.js` into a folder.
2. Serve with a simple static server to avoid file:// CORS quirks:
   - Python 3:
     ```
     python3 -m http.server 8000
     ```
     Visit: http://localhost:8000
   - Or use `npx serve .` or any static host.
3. Use the UI: set Suburb (e.g., `Belmont North`), choose endpoint `Amenities` (or `Ethnicity`), click **Fetch Data**.

---

## Alternatives (if you prefer not to use Cloudflare Workers)

- Local Flask proxy (fast for development)
  ```python
  from flask import Flask, request, Response
  import requests

  app = Flask(__name__)
  CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  }

  @app.route("/suburb/<path:slug>", methods=["GET","OPTIONS"])
  def suburb(slug):
      if request.method == "OPTIONS":
          resp = Response(status=204)
          for k,v in CORS_HEADERS.items(): resp.headers[k]=v
          return resp
      upstream = f"https://www.microburbs.com.au/report_generator/api/suburb/{slug}"
      r = requests.get(upstream, params=request.args, headers={"Authorization":"Bearer test"})
      resp = Response(r.content, status=r.status_code)
      for k,v in CORS_HEADERS.items(): resp.headers[k]=v
      resp.headers["Content-Type"] = r.headers.get("Content-Type","application/json")
      return resp

  if __name__ == "__main__":
      app.run(port=8787)
  ```
  - Run: `pip install flask requests` then `python proxy.py`
  - Point frontend to `http://localhost:8787/suburb/amenity?suburb=Belmont%20North`

- Vercel serverless / Edge function — similar to Worker but deploys from a Git repo and gives a stable URL.

---

## Troubleshooting

- "Assets have not yet been deployed..." on root:
  - That message is usually from Cloudflare Pages when a Pages site exists but has no builds. The Worker’s root should instead render the status HTML (see Worker code above). Make sure you're accessing the Worker URL (workers.dev) not a Pages domain.
  - Clear your browser cache or open an incognito window to avoid cached placeholders.

- "Blocked by CORS policy":
  - If you directly call Microburbs API from the browser with `Authorization` header, the browser sends a preflight and Microburbs does not return the required CORS headers — request is blocked. That's why the proxy is needed.
  - Ensure the frontend is calling your Worker’s URL (`PROXY_BASE`) and not the Microburbs domain.

- Windows PowerShell + curl:
  - Use `curl.exe` instead of `curl` in PowerShell to call the real curl binary:
    ```
    curl.exe -i "https://mb-proxy-<yourname>.workers.dev/"
    ```

- If Worker returns upstream `401` or `403`:
  - Confirm the Worker adds the Authorization header for the path you are using (non-sandbox paths). Check the Worker code and redeploy.

---

## What the client code does (file-by-file summary)

- index.html
  - Minimal UI that loads `styles.css` and `app.js`. Contains input fields (suburb and endpoint), action buttons, and containers for summary, table and chart.

- styles.css
  - Simple modern dark theme. Controls layout, card styles, table and small chart container.

- app.js
  - Config at top (`USE_PROXY`, `PROXY_BASE`, `PATH_PREFIX`).
  - UI bindings: reads suburb and endpoint selection, builds the final URL.
  - `buildUrl()` decides whether to call the Worker proxy or the sandbox direct URL.
  - `onFetch()` performs a `fetch()` with `method: "GET"` and no custom headers (important — avoids preflight).
  - `renderAll()`:
    - Shows raw JSON (optional)
    - Computes and renders summary KPIs
    - Flattens JSON to build a table (array → rows, object → key/value)
    - Detects numeric fields and draws a small Canvas bar chart of the top numeric signals
  - Helper functions: `flattenObject`, `formatNumber`, `escapeHtml`, `copyCurl`, and a tiny toast.

---

## Security & privacy notes

- Do NOT include private API keys in client-side code. The Worker keeps `Bearer test` (or any other token) server-side so it is not exposed to the browser.
- The Worker in this repo uses a simple global token. For production, rotate tokens and restrict which endpoints the Worker can call, and add rate-limiting or authentication on the Worker if you will expose it publicly.
- The public Worker returns `Access-Control-Allow-Origin: *`. If your project is for internal use, restrict this header to your allowed origin(s).

---

## Final tips & next steps

- After verifying your Worker returns JSON successfully for `/suburb/amenity`, set `PROXY_BASE` in `app.js` and host the UI (GitHub Pages is fine).
- Optionally extend the UI with:
  - CSV export
  - Leaflet map with property points
  - More robust field-specific visualisations (time series, distribution)
- If you want, I can:
  - Prepare a ready-to-paste Cloudflare Worker repo (wrangler-compatible) or
  - Provide a small GitHub Pages deployment guide to host the UI and use the Worker proxy.

---

License: MIT-style (please add a LICENSE file if you want to publish publicly).
