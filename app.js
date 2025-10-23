// Microburbs Suburb Explorer — app.js
// Uses a Cloudflare Worker proxy to bypass CORS and (optionally) add Authorization upstream.
// 1) Set PROXY_BASE to your worker URL (e.g., https://mb-proxy-yourname.workers.dev)
// 2) If you want to hit sandbox instead of live API via the worker, set PATH_PREFIX = "sandbox/suburb"
// 3) Keep fetch() without headers (proxy adds Authorization for non-sandbox paths)

const USE_PROXY = true;
const PROXY_BASE = "https://mb-proxy-yourname.workers.dev"; // TODO: replace with your Worker URL
const SANDBOX_BASE_DIRECT = "https://www.microburbs.com.au/report_generator/api/sandbox/suburb"; // fallback if not using proxy

// Choose which upstream path to proxy:
// - "suburb" → worker will call /report_generator/api/suburb/<slug>?...
// - "sandbox/suburb" → worker will call /report_generator/api/sandbox/suburb/<slug>?...
const PATH_PREFIX = "suburb"; // or "sandbox/suburb"

const endpointOptions = [
  { label: "Amenities", slug: "amenity" },
  { label: "Demographics", slug: "demographics" },
  { label: "Ethnicity by Pocket", slug: "ethnicity" },
  { label: "Market Insights", slug: "market-insights" },
  { label: "Market Insights by Pocket", slug: "market-insights-by-pocket" },
  { label: "Market Insights by Street", slug: "market-insights-by-street" },
  { label: "Risk Factors", slug: "risk-factors" },
  { label: "School Catchments", slug: "school-catchments" },
  { label: "Schools", slug: "schools" },
  { label: "Similar Suburbs", slug: "similar-suburbs" },
  { label: "Suburb Information", slug: "suburb-information" },
  { label: "Summary", slug: "summary" },
  { label: "Zoning", slug: "zoning" },
  { label: "Custom… (type your own)", slug: "__custom__" },
];

const els = {
  suburb: document.getElementById("suburb"),
  endpoint: document.getElementById("endpoint"),
  fetchBtn: document.getElementById("fetchBtn"),
  openUrlBtn: document.getElementById("openUrlBtn"),
  copyCurlBtn: document.getElementById("copyCurlBtn"),
  toggleRaw: document.getElementById("toggleRaw"),
  reqUrl: document.getElementById("reqUrl"),
  summary: document.getElementById("summary"),
  summaryCards: document.getElementById("summaryCards"),
  chartSection: document.getElementById("chartSection"),
  chartNote: document.getElementById("chartNote"),
  barChart: document.getElementById("barChart"),
  tableSection: document.getElementById("tableSection"),
  tableNote: document.getElementById("tableNote"),
  dataTable: document.getElementById("dataTable"),
  jsonSection: document.getElementById("jsonSection"),
  rawJson: document.getElementById("rawJson"),
};

let customSlugInput = null;

// Populate endpoint dropdown
(function initEndpoints(){
  for (const opt of endpointOptions){
    const o = document.createElement("option");
    o.value = opt.slug;
    o.textContent = opt.label;
    els.endpoint.appendChild(o);
  }
  // When "Custom" selected, show an inline input
  els.endpoint.addEventListener("change", () => {
    if (els.endpoint.value === "__custom__") {
      if (!customSlugInput) {
        customSlugInput = document.createElement("input");
        customSlugInput.type = "text";
        customSlugInput.placeholder = "Enter custom endpoint slug, e.g., development-applications";
        customSlugInput.className = "custom-slug";
        els.endpoint.parentElement.appendChild(customSlugInput);
      }
      customSlugInput.style.display = "block";
      customSlugInput.focus();
    } else if (customSlugInput) {
      customSlugInput.style.display = "none";
    }
    updateRequestUrlPreview();
  });
})();

function getSlug(){
  const selected = els.endpoint.value;
  if (selected === "__custom__"){
    const val = (customSlugInput?.value || "").trim();
    return val || "amenity";
  }
  return selected;
}

function buildUrl(){
  const suburb = (els.suburb.value || "").trim();
  const slug = getSlug();

  if (USE_PROXY && PROXY_BASE) {
    // Worker route: https://<worker>/suburb/<slug>?suburb=...
    // or:          https://<worker>/sandbox/suburb/<slug>?suburb=...
    return `${PROXY_BASE}/${PATH_PREFIX}/${encodeURIComponent(slug)}?suburb=${encodeURIComponent(suburb)}`;
  }

  // Direct sandbox (may still CORS-block on some origins)
  return `${SANDBOX_BASE_DIRECT}/${encodeURIComponent(slug)}?suburb=${encodeURIComponent(suburb)}`;
}

function updateRequestUrlPreview(){
  els.reqUrl.textContent = buildUrl();
}
updateRequestUrlPreview();

// Wire buttons
els.suburb.addEventListener("input", updateRequestUrlPreview);
els.endpoint.addEventListener("change", updateRequestUrlPreview);
els.fetchBtn.addEventListener("click", onFetch);
els.openUrlBtn.addEventListener("click", () => window.open(buildUrl(), "_blank"));
els.copyCurlBtn.addEventListener("click", copyCurl);
els.toggleRaw.addEventListener("change", () => {
  els.jsonSection.classList.toggle("hidden", !els.toggleRaw.checked);
});

async function onFetch(){
  const url = buildUrl();
  showLoadingState(true);
  try {
    const res = await fetch(url, { method: "GET" }); // no headers (proxy handles auth/CORS)
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderAll(data);
  } catch (err) {
    renderError(err);
  } finally {
    showLoadingState(false);
  }
}

function showLoadingState(isLoading){
  els.fetchBtn.disabled = isLoading;
  els.fetchBtn.textContent = isLoading ? "Loading…" : "Fetch Data";
  if (isLoading) {
    els.summary.classList.add("hidden");
    els.chartSection.classList.add("hidden");
    els.tableSection.classList.add("hidden");
  }
}

function renderError(err){
  const msg = { error: true, message: String(err), url: buildUrl() };
  els.rawJson.textContent = JSON.stringify(msg, null, 2);
  els.jsonSection.classList.toggle("hidden", !els.toggleRaw.checked);
  els.summary.classList.add("hidden");
  els.chartSection.classList.add("hidden");
  els.tableSection.classList.add("hidden");
}

function renderAll(data){
  // Raw JSON
  els.rawJson.textContent = JSON.stringify(data, null, 2);
  els.jsonSection.classList.toggle("hidden", !els.toggleRaw.checked);

  // Summary cards
  const summary = computeSummary(data);
  renderSummary(summary);

  // Table
  renderTable(data);

  // Chart (top numeric pairs)
  const numericPairs = findNumericPairs(data);
  renderChart(numericPairs);
}

function computeSummary(data){
  const out = [];
  if (Array.isArray(data)) {
    out.push({ label: "Items", value: data.length.toLocaleString() });
    const sampleKeys = Object.keys(flattenObject(data[0] || {}));
    out.push({ label: "Fields (sample)", value: sampleKeys.length });
    out.push({ label: "Type", value: "Array" });
  } else if (data && typeof data === "object") {
    const flat = flattenObject(data);
    out.push({ label: "Fields", value: Object.keys(flat).length.toLocaleString() });
    out.push({ label: "Type", value: "Object" });
  } else {
    out.push({ label: "Type", value: typeof data });
  }
  const flat = flattenObject(data);
  const suburb = flat["suburb"] || flat["name"] || flat["area"] || "";
  if (suburb) out.push({ label: "Context", value: String(suburb).slice(0, 48) });
  return out;
}

function renderSummary(items){
  els.summaryCards.innerHTML = "";
  for (const it of items){
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<div class="label">${escapeHtml(String(it.label))}</div>
                     <div class="value">${escapeHtml(String(it.value))}</div>`;
    els.summaryCards.appendChild(div);
  }
  els.summary.classList.toggle("hidden", items.length === 0);
}

function renderTable(data){
  els.dataTable.innerHTML = "";
  if (Array.isArray(data)){
    const N = 40;
    const colsSet = new Set();
    for (const row of data.slice(0, N)){
      Object.keys(row || {}).forEach(k => colsSet.add(k));
    }
    const cols = [...colsSet];

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    cols.forEach(c => {
      const th = document.createElement("th");
      th.textContent = c;
      htr.appendChild(th);
    });
    thead.appendChild(htr);

    const tbody = document.createElement("tbody");
    for (const row of data){
      const tr = document.createElement("tr");
      cols.forEach(c => {
        const td = document.createElement("td");
        const val = row?.[c];
        td.textContent = formatVal(val);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    els.dataTable.appendChild(thead);
    els.dataTable.appendChild(tbody);
    els.tableNote.textContent = `Showing ${data.length.toLocaleString()} rows, ${cols.length} columns.`;
    els.tableSection.classList.remove("hidden");
  } else if (data && typeof data === "object"){
    const flat = flattenObject(data, 2);
    const cols = ["key", "value"];
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    cols.forEach(c => {
      const th = document.createElement("th");
      th.textContent = c;
      htr.appendChild(th);
    });
    thead.appendChild(htr);

    const tbody = document.createElement("tbody");
    Object.entries(flat).forEach(([k, v]) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td"); td1.textContent = k;
      const td2 = document.createElement("td"); td2.textContent = formatVal(v);
      tr.appendChild(td1); tr.appendChild(td2);
      tbody.appendChild(tr);
    });

    els.dataTable.appendChild(thead);
    els.dataTable.appendChild(tbody);
    els.tableNote.textContent = `${Object.keys(flat).length} fields. Nested collections are flattened.`;
    els.tableSection.classList.remove("hidden");
  } else {
    els.tableSection.classList.add("hidden");
  }
}

function findNumericPairs(data){
  const flat = flattenObject(data);
  const pairs = [];
  for (const [k, v] of Object.entries(flat)) {
    const num = typeof v === "number" ? v : (typeof v === "string" ? Number(v) : NaN);
    if (!Number.isFinite(num)) continue;
    if (Math.abs(num) === 0) continue;
    pairs.push({ label: k, value: num });
  }
  pairs.sort((a,b) => Math.abs(b.value) - Math.abs(a.value));
  return pairs.slice(0, 12);
}

function renderChart(pairs){
  if (!pairs || !pairs.length){
    els.chartSection.classList.add("hidden");
    return;
  }
  els.chartSection.classList.remove("hidden");
  els.chartNote.textContent = `Top ${pairs.length} numeric fields by magnitude (auto-detected).`;

  const canvas = els.barChart;
  const ctx = canvas.getContext("2d");

  const containerWidth = canvas.parentElement.clientWidth - 20;
  canvas.width = containerWidth;

  const leftPad = 180;
  const rightPad = 16;
  const topPad = 16;
  const rowH = 22;
  const gap = 8;
  const totalH = topPad + (rowH + gap) * pairs.length + 12;
  canvas.height = totalH;

  ctx.fillStyle = "#0b152a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const maxVal = Math.max(...pairs.map(p => Math.abs(p.value))) || 1;

  pairs.forEach((p, i) => {
    const y = topPad + i * (rowH + gap);
    ctx.fillStyle = "#93a1b5";
    ctx.font = "12px Inter, sans-serif";
    const label = p.label.length > 34 ? p.label.slice(0, 31) + "…" : p.label;
    ctx.fillText(label, 8, y + 14);

    const barMaxW = canvas.width - leftPad - rightPad;
    const barW = Math.max(2, Math.round((Math.abs(p.value) / maxVal) * barMaxW));
    const x = leftPad;
    const color = p.value >= 0 ? "#5b9cff" : "#ff8b5b";
    ctx.fillStyle = color;
    ctx.fillRect(x, y, barW, rowH);

    ctx.fillStyle = "#e6edf6";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText(formatNumber(p.value), x + barW + 6, y + 14);
  });
}

function flattenObject(obj, depthLimit = 4, prefix = "", out = {}){
  if (obj === null || obj === undefined) return out;
  if (depth(prefix) >= depthLimit) {
    out[prefix || "value"] = summarize(obj);
    return out;
  }
  if (Array.isArray(obj)){
    out[prefix ? `${prefix}.__len` : "__len"] = obj.length;
    obj.slice(0, 8).forEach((v, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      if (typeof v === "object" && v !== null) flattenObject(v, depthLimit, p, out);
      else out[p] = v;
    });
    return out;
  }
  if (typeof obj === "object"){
    for (const [k, v] of Object.entries(obj)){
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flattenObject(v, depthLimit, p, out);
      else out[p] = v;
    }
    return out;
  }
  out[prefix || "value"] = obj;
  return out;

  function depth(s){ return s ? (s.match(/\./g)?.length || 0) : 0; }
}

function summarize(v){
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (v && typeof v === "object") return `Object(${Object.keys(v).length} keys)`;
  return String(v);
}

function formatVal(v){
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function formatNumber(n){
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n/1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n/1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return (n/1_000).toFixed(2) + "k";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(2);
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function copyCurl(){
  const url = buildUrl();
  const curl = ["curl","-s", `"${url}"`].join(" ");
  navigator.clipboard.writeText(curl).then(()=>{
    toast("cURL copied!");
  }).catch(()=>{
    alert(curl);
  });
}

function toast(msg){
  const t = document.createElement("div");
  t.textContent = msg;
  Object.assign(t.style, {
    position:"fixed", bottom:"20px", left:"50%", transform:"translateX(-50%)",
    background:"#0e182a", color:"#e6edf6", border:"1px solid #1d2a44",
    padding:"10px 14px", borderRadius:"10px", zIndex:"9999",
    boxShadow:"0 6px 22px rgba(0,0,0,.35)"
  });
  document.body.appendChild(t);
  setTimeout(()=> t.remove(), 1500);
}

// Initial demo fetch on load
window.addEventListener("load", onFetch);