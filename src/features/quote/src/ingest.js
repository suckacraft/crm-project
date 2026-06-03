// ─────────────────────────────────────────────────────────────────────────────
// ingest.js — turn an uploaded File into an IngestedDocument the extractors can
// consume, regardless of format. Handles the three formats you flagged:
//   • Excel / CSV  → structured tables (via SheetJS, already used by the CRM)
//   • PDF          → text + naive row reconstruction (via pdf.js, CDN)
//   • Email / HTML / text → text + any <table> grids
//
// IngestedDocument = { fileName, mimeType, text, tables:[{name, rows}], pages }
// "tables" is the high-signal structured view; "text" is the flat fallback the
// LLM also gets. Browser-only (uses FileReader + globals XLSX / pdfjsLib).
// ─────────────────────────────────────────────────────────────────────────────

export async function ingestFile(file) {
  const name = file.name || "quote";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const mime = file.type || "";

  if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel"))
    return ingestExcel(file);
  if (ext === "csv" || mime === "text/csv") return ingestCsv(file);
  if (ext === "pdf" || mime.includes("pdf")) return ingestPdf(file);
  if (ext === "html" || ext === "htm" || mime.includes("html") || ext === "eml")
    return ingestHtml(file);
  return ingestText(file); // .txt and anything else
}

// ── Excel ─────────────────────────────────────────────────────────────────────
async function ingestExcel(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const tables = wb.SheetNames.map(sheet => ({
    name: sheet,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false, defval: "" })
      .map(r => r.map(cellToText)),
  }));
  const text = tables.map(t => `# ${t.name}\n` + t.rows.map(r => r.join("\t")).join("\n")).join("\n\n");
  return doc(file, "application/vnd.ms-excel", text, tables, tables.length);
}

// ── CSV ───────────────────────────────────────────────────────────────────────
async function ingestCsv(file) {
  const text = await file.text();
  const rows = parseCsv(text);
  return doc(file, "text/csv", text, [{ name: "CSV", rows }], 1);
}

// ── PDF (pdf.js) ──────────────────────────────────────────────────────────────
async function ingestPdf(file) {
  if (typeof pdfjsLib === "undefined")
    throw new Error("pdf.js not loaded — cannot read PDF");
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pageTexts = [];
  const tables = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const { text, rows } = reconstructRows(content.items);
    pageTexts.push(text);
    if (rows.length) tables.push({ name: `page ${p}`, rows });
  }
  return doc(file, "application/pdf", pageTexts.join("\n\n"), tables, pdf.numPages);
}

// Group PDF text fragments into rows by Y position, columns by X — a pragmatic
// reconstruction that gives the mock extractor a fighting chance and the LLM a
// clean tabular view. Not pixel-perfect; the LLM tolerates the slack.
function reconstructRows(items) {
  const frags = items.filter(i => i.str && i.str.trim()).map(i => ({
    str: i.str, x: i.transform[4], y: Math.round(i.transform[5]),
  }));
  const byY = new Map();
  for (const f of frags) {
    // bucket Y to nearest 3px to tolerate baseline jitter
    const key = Math.round(f.y / 3) * 3;
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key).push(f);
  }
  const rows = [...byY.entries()].sort((a, b) => b[0] - a[0]) // top-to-bottom
    .map(([, fs]) => fs.sort((a, b) => a.x - b.x).map(f => f.str.trim()));
  const text = rows.map(r => r.join("  ")).join("\n");
  return { text, rows };
}

// ── HTML / email ──────────────────────────────────────────────────────────────
async function ingestHtml(file) {
  const html = await file.text();
  const dom = new DOMParser().parseFromString(html, "text/html");
  const tables = [...dom.querySelectorAll("table")].map((tbl, i) => ({
    name: `table ${i + 1}`,
    rows: [...tbl.querySelectorAll("tr")].map(tr =>
      [...tr.querySelectorAll("th,td")].map(td => td.textContent.trim())),
  })).filter(t => t.rows.length);
  const text = (dom.body?.innerText || dom.body?.textContent || "").trim();
  return doc(file, "text/html", text, tables, 1);
}

// ── plain text ────────────────────────────────────────────────────────────────
async function ingestText(file) {
  const text = await file.text();
  // Opportunistically detect a delimited block so even .txt quotes get a table.
  const rows = parseCsv(text);
  const tables = rows.length > 1 && rows[0].length > 1 ? [{ name: "text", rows }] : [];
  return doc(file, "text/plain", text, tables, 1);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function doc(file, mimeType, text, tables, pages) {
  return { fileName: file.name || "quote", mimeType, text: text || "", tables: tables || [], pages: pages || 1 };
}
function cellToText(c) {
  if (c == null) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c);
}
// Minimal RFC-ish CSV parser (handles quotes, commas, embedded newlines).
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}
