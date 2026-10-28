// Vercel serverless function: POST /api/rokomari-import
// Keeps FIRECRAWL_API_KEY server-side. No browser-side secret exposure.
const FIRECRAWL = "https://api.firecrawl.dev/v2";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "শুধু POST request অনুমোদিত।" });
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Vercel-এ FIRECRAWL_API_KEY সেট করা নেই।" });

  const body = req.body || {};
  const categoryUrl = String(body.categoryUrl || "").trim();
  const limit = Math.max(1, Math.min(2, Number(body.limit) || 2));

  let parsed;
  try { parsed = new URL(categoryUrl); } catch (_) {
    return res.status(400).json({ error: "সঠিক Rokomari category URL দিন।" });
  }
  if (parsed.protocol !== "https:" || !/(^|\.)rokomari\.com$/i.test(parsed.hostname)) {
    return res.status(400).json({ error: "শুধু https://www.rokomari.com এর URL ব্যবহার করুন।" });
  }

  const headers = { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
  async function firecrawl(path, payload) {
    const response = await fetch(FIRECRAWL + path, {
      method: "POST", headers, body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || data.message || ("Firecrawl HTTP " + response.status);
      throw new Error(String(message).slice(0, 400));
    }
    return data;
  }

  try {
    const map = await firecrawl("/map", { url: parsed.toString(), limit: 5, includeSubdomains: false });
    const links = Array.isArray(map.links) ? map.links : [];
    const candidates = [...new Set(links.map(item => typeof item === "string" ? item : item.url)
      .filter(Boolean).map(value => {
        try { const u = new URL(value); u.hash = ""; return u.toString(); } catch (_) { return ""; }
      }).filter(value => {
        try {
          const u = new URL(value);
          return u.hostname === "www.rokomari.com" &&
            /\/book\//i.test(u.pathname) &&
            !/\/book\/category\//i.test(u.pathname) &&
            !/[?&](sort|page|filter)=/i.test(u.search);
        } catch (_) { return false; }
      }))].slice(0, limit);

    if (!candidates.length) {
      return res.status(200).json({
        discoveredCount: links.length, candidateCount: 0, attemptedCount: 0,
        failedCount: 0, duplicateCount: 0, products: [],
        warnings: ["Firecrawl Map থেকে বইয়ের detail URL পাওয়া যায়নি। Rokomari category pagination বা Map coverage সীমিত হতে পারে।"]
      });
    }

    const products = [];
    let failedCount = 0;
    const warnings = [];
    for (const url of candidates) {
      try {
        const scraped = await firecrawl("/scrape", {
          url, formats: ["markdown"], onlyMainContent: true, timeout: 30000
        });
        const data = scraped.data || scraped;
        const markdown = String(data.markdown || data.content || "");
        const metadata = data.metadata || {};
        const title = String(metadata.title || "").replace(/\s*[|–-]\s*Rokomari.*$/i, "").trim();
        const pick = (patterns) => {
          for (const pattern of patterns) {
            const match = markdown.match(pattern);
            if (match && match[1]) return match[1].replace(/\s+/g, " ").trim().slice(0, 250);
          }
          return "";
        };
        const price = pick([/(?:বর্তমান মূল্য|দাম|Price|৳)\s*[:：-]?\s*(?:৳\s*)?([0-9,]+(?:\.[0-9]+)?)/i, /৳\s*([0-9,]+(?:\.[0-9]+)?)/]);
        const author = pick([/(?:লেখক|Author)\s*[:：-]?\s*([^\n|]+)/i]);
        const publisher = pick([/(?:প্রকাশনী|প্রকাশক|Publisher)\s*[:：-]?\s*([^\n|]+)/i]);
        const imageUrl = String(metadata.ogImage || metadata.image || (Array.isArray(data.images) ? data.images[0] : "") || "");
        products.push({
          productName: title || pick([/^#\s+(.+)$/m]) || "",
          author, publisher, imageUrl, currentPrice: price, previousPrice: "",
          originalProductUrl: url, isbn: "", shortDescription: "",
          sourceWebsite: "Rokomari", dataStatus: title ? "পৃষ্ঠা থেকে সংগ্রহ করা" : "তথ্য যাচাই প্রয়োজন"
        });
      } catch (error) {
        failedCount++;
        if (warnings.length < 5) warnings.push("একটি পৃষ্ঠা সংগ্রহ করা যায়নি: " + String(error.message || error).slice(0, 180));
      }
    }

    const unique = [];
    const seen = new Set();
    for (const p of products) {
      if (seen.has(p.originalProductUrl)) continue;
      seen.add(p.originalProductUrl);
      unique.push(p);
    }
    if (links.length <= 1) warnings.push("Map মাত্র " + links.length + "টি link দিয়েছে; পুরো category বা সব pagination পাওয়া গেছে—এমন নিশ্চয়তা নেই।");
    warnings.push("নাম, লেখক, ছবি ও দাম export করার আগে preview-তে যাচাই করুন; Rokomari-এর পৃষ্ঠা অনুযায়ী কিছু তথ্য অনুপস্থিত থাকতে পারে।");

    return res.status(200).json({
      discoveredCount: links.length, candidateCount: candidates.length,
      attemptedCount: candidates.length, failedCount,
      duplicateCount: products.length - unique.length, products: unique, warnings
    });
  } catch (error) {
    return res.status(502).json({
      error: "Firecrawl request ব্যর্থ: " + String(error.message || error).slice(0, 350)
    });
  }
};
