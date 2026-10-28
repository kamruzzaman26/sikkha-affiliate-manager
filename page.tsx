'use client';

import { useMemo, useState } from "react";

type Product = {
  productName: string;
  author: string;
  imageUrl: string;
  currentPrice: string;
  previousPrice: string;
  originalProductUrl: string;
  publisher: string;
  isbn: string;
  shortDescription: string;
  sourceWebsite: "Rokomari";
  dataStatus: "partial" | "needs_review";
};

type Result = {
  success?: boolean;
  error?: string;
  categoryUrl?: string;
  discoveredCount?: number;
  candidateCount?: number;
  attemptedCount?: number;
  failedCount?: number;
  duplicateCount?: number;
  coverage?: string;
  warnings?: string[];
  products?: Product[];
};

const emptyProduct = (): Product => ({
  productName: "", author: "", imageUrl: "", currentPrice: "", previousPrice: "",
  originalProductUrl: "", publisher: "", isbn: "", shortDescription: "",
  sourceWebsite: "Rokomari", dataStatus: "needs_review"
});

export default function RokomariImporterPage() {
  const [categoryUrl, setCategoryUrl] = useState("https://www.rokomari.com/book/category/81/islamic-books");
  const [limit, setLimit] = useState(20);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const products = result?.products ?? [];
  const selectedProducts = useMemo(
    () => products.filter(p => selected[p.originalProductUrl] !== false),
    [products, selected]
  );

  async function runImport() {
    setBusy(true);
    setError("");
    setResult(null);
    setSelected({});
    try {
      const response = await fetch("/api/rokomari-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryUrl, limit })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
      setResult(data);
      const initial: Record<string, boolean> = {};
      for (const p of (data.products ?? [])) initial[p.originalProductUrl] = true;
      setSelected(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import ব্যর্থ হয়েছে।");
    } finally {
      setBusy(false);
    }
  }

  function exportJson() {
    downloadFile(JSON.stringify(selectedProducts, null, 2), "rokomari-products.json", "application/json;charset=utf-8");
  }

  function exportCsv() {
    const columns: (keyof Product)[] = [
      "productName", "author", "imageUrl", "currentPrice", "previousPrice",
      "originalProductUrl", "publisher", "isbn", "shortDescription", "sourceWebsite", "dataStatus"
    ];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [columns.join(","), ...selectedProducts.map(p => columns.map(c => escape(p[c])).join(","))].join("\r\n");
    downloadFile("\uFEFF" + csv, "rokomari-products.csv", "text/csv;charset=utf-8");
  }

  function updateProduct(index: number, field: keyof Product, value: string) {
    setResult(prev => {
      if (!prev?.products) return prev;
      const next = [...prev.products];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, products: next };
    });
  }

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, sans-serif", color: "#182230" }}>
      <header style={{ marginBottom: 20 }}>
        <p style={{ color: "#2463eb", fontWeight: 700, marginBottom: 6 }}>শিক্ষা নগরী · পরীক্ষামূলক টুল</p>
        <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: "0 0 8px" }}>Rokomari Category Importer</h1>
        <p style={{ color: "#536174", margin: 0 }}>শুধু Firecrawl API ব্যবহার করে link discovery ও product metadata সংগ্রহের চেষ্টা করে।</p>
      </header>

      <section style={{ border: "1px solid #dbe2ea", borderRadius: 14, padding: 16, marginBottom: 18 }}>
        <label htmlFor="categoryUrl" style={{ display: "block", fontWeight: 650, marginBottom: 6 }}>Rokomari category URL</label>
        <input id="categoryUrl" value={categoryUrl} onChange={e => setCategoryUrl(e.target.value)}
          placeholder="https://www.rokomari.com/book/category/..."
          style={{ width: "100%", boxSizing: "border-box", padding: 12, border: "1px solid #b9c4d2", borderRadius: 8, fontSize: 15 }} />
        <div style={{ display: "flex", alignItems: "end", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
          <div>
            <label htmlFor="limit" style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>সর্বোচ্চ product page (১–৩০)</label>
            <input id="limit" type="number" min={1} max={30} value={limit}
              onChange={e => setLimit(Math.min(30, Math.max(1, Number(e.target.value) || 1)))}
              style={{ width: 140, padding: 10, border: "1px solid #b9c4d2", borderRadius: 8 }} />
          </div>
          <button onClick={runImport} disabled={busy}
            style={{ background: busy ? "#91a2bb" : "#1d4ed8", color: "white", border: 0, padding: "12px 18px", borderRadius: 8, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
            {busy ? "Firecrawl চলছে…" : "ক্যাটাগরি সংগ্রহ শুরু"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#667085", marginBottom: 0 }}>API key server-side `.env.local`-এ থাকবে। Map সব pagination খুঁজে পাবে—এমন নিশ্চয়তা নেই।</p>
      </section>

      {error && <div role="alert" style={{ background: "#fff1f0", border: "1px solid #ffccc7", padding: 12, borderRadius: 8, marginBottom: 16 }}>{error}</div>}

      {result && <>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            ["Map links", result.discoveredCount ?? 0],
            ["Product candidates", result.candidateCount ?? 0],
            ["Attempted", result.attemptedCount ?? 0],
            ["Failed", result.failedCount ?? 0],
            ["Duplicates", result.duplicateCount ?? 0]
          ].map(([label, value]) => <div key={String(label)} style={{ border: "1px solid #dbe2ea", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, color: "#667085" }}>{label}</div><strong style={{ fontSize: 23 }}>{value}</strong>
          </div>)}
        </section>

        {!!result.warnings?.length && <section style={{ background: "#fff8e6", border: "1px solid #f1d38a", borderRadius: 10, padding: 12, marginBottom: 16 }}>
          <strong>সতর্কতা</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </section>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
          <strong style={{ marginRight: "auto" }}>Preview: {products.length}টি row</strong>
          <button onClick={exportCsv} disabled={!selectedProducts.length} style={buttonStyle}>CSV Export ({selectedProducts.length})</button>
          <button onClick={exportJson} disabled={!selectedProducts.length} style={buttonStyle}>JSON Export ({selectedProducts.length})</button>
        </div>

        <div style={{ overflowX: "auto", border: "1px solid #dbe2ea", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead><tr style={{ background: "#f5f7fa", textAlign: "left" }}>
              <th style={cellStyle}>Export</th><th style={cellStyle}>Cover</th><th style={cellStyle}>বইয়ের নাম</th>
              <th style={cellStyle}>লেখক</th><th style={cellStyle}>দাম</th><th style={cellStyle}>মূল URL</th><th style={cellStyle}>Status</th>
            </tr></thead>
            <tbody>
              {products.map((p, i) => <tr key={p.originalProductUrl} style={{ borderTop: "1px solid #e5eaf0", verticalAlign: "top" }}>
                <td style={cellStyle}><input aria-label="Export this row" type="checkbox" checked={selected[p.originalProductUrl] !== false}
                  onChange={e => setSelected(prev => ({ ...prev, [p.originalProductUrl]: e.target.checked }))} /></td>
                <td style={cellStyle}>{p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: 56, maxHeight: 76, objectFit: "contain" }} /> : "ছবি নেই"}</td>
                <td style={cellStyle}><input value={p.productName} onChange={e => updateProduct(i, "productName", e.target.value)} style={editStyle} placeholder="নাম যাচাই করুন" />
                  <input value={p.publisher} onChange={e => updateProduct(i, "publisher", e.target.value)} style={{ ...editStyle, marginTop: 5 }} placeholder="প্রকাশক (ঐচ্ছিক)" /></td>
                <td style={cellStyle}><input value={p.author} onChange={e => updateProduct(i, "author", e.target.value)} style={editStyle} placeholder="লেখক যাচাই করুন" />
                  <input value={p.isbn} onChange={e => updateProduct(i, "isbn", e.target.value)} style={{ ...editStyle, marginTop: 5 }} placeholder="ISBN (ঐচ্ছিক)" /></td>
                <td style={cellStyle}><input value={p.currentPrice} onChange={e => updateProduct(i, "currentPrice", e.target.value)} style={{ ...editStyle, width: 100 }} placeholder="দাম" />
                  <input value={p.previousPrice} onChange={e => updateProduct(i, "previousPrice", e.target.value)} style={{ ...editStyle, width: 100, marginTop: 5 }} placeholder="আগের দাম" /></td>
                <td style={cellStyle}><a href={p.originalProductUrl} target="_blank" rel="noreferrer" style={{ overflowWrap: "anywhere" }}>Product page</a></td>
                <td style={cellStyle}><span style={{ fontSize: 12, background: p.dataStatus === "partial" ? "#e8f7ee" : "#fff0d6", padding: "4px 6px", borderRadius: 6 }}>{p.dataStatus}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
      <footer style={{ marginTop: 20, color: "#667085", fontSize: 13 }}>
        এই টুল মূল affiliate manager-এ নিজে থেকে data write করে না। Export করে যাচাই করার পর manager-এ import করবে। API key বা source response থেকে কোনো তথ্য অনুমান করে verified বলা হয় না।
      </footer>
    </main>
  );
}

const cellStyle: React.CSSProperties = { padding: 10, borderBottom: "1px solid #e5eaf0" };
const editStyle: React.CSSProperties = { width: "100%", minWidth: 130, boxSizing: "border-box", padding: 7, border: "1px solid #cbd5e1", borderRadius: 6 };
const buttonStyle: React.CSSProperties = { padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 8, background: "white", cursor: "pointer" };

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
