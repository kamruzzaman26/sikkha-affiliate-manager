module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "শুধু POST request অনুমোদিত।" }); }
  const body = req.body || {};
  const categoryUrl = String(body.categoryUrl || "").trim();
  const limit = Math.max(1, Math.min(20, Number(body.limit) || 10));
  let category;
  try { category = new URL(categoryUrl); } catch (_) { return res.status(400).json({ error: "সঠিক Rokomari category URL দিন।" }); }
  if (category.protocol !== "https:" || !/(^|\.)rokomari\.com$/i.test(category.hostname)) return res.status(400).json({ error: "শুধু Rokomari-এর HTTPS URL ব্যবহার করুন।" });
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; SikkhaNogoriCatalog/1.0)", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "bn-BD,bn;q=0.9,en-US;q=0.8,en;q=0.7" };
  async function getHtml(url) {
    const r = await fetch(url, { headers, redirect: "follow" });
    if (!r.ok) throw new Error("Rokomari HTTP " + r.status);
    const html = await r.text();
    if (/captcha|verify you are human|access denied/i.test(html.slice(0, 8000))) throw new Error("Rokomari direct request আটকে দিয়েছে।");
    return html;
  }
  function decode(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  function meta(html, keys) {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const key of keys) for (const tag of tags) {
      const name = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1];
      const value = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
      if (name && value && name.toLowerCase() === key.toLowerCase()) return decode(value);
    }
    return "";
  }
  function absolute(value, base) {
    if (!value) return "";
    try { const u = new URL(decode(value), base); if (u.protocol !== "https:" || !/(^|\.)rokomari\.com$/i.test(u.hostname)) return ""; u.hash = ""; return u.toString(); } catch (_) { return ""; }
  }
  function linksFrom(html, base) {
    const out = [], re = /href\s*=\s*["']([^"']*\/book\/[^"']*)["']/gi; let m;
    while ((m = re.exec(html))) {
      const link = absolute(m[1], base); if (!link) continue;
      const u = new URL(link);
      if (/\/book\/(category|author|publisher|review)\//i.test(u.pathname)) continue;
      if (!/\/book\/[^/]+\/\d+\/?$/i.test(u.pathname) && !/\/book\/[^/]+\/[^/]+\/\d+\/?$/i.test(u.pathname)) continue;
      out.push(link);
    }
    return [...new Set(out)];
  }
  function field(html, patterns) { for (const re of patterns) { const m = html.match(re); if (m && m[1]) return decode(m[1]).slice(0, 250); } return ""; }
  try {
    const html = await getHtml(category.toString()), allLinks = linksFrom(html, category.toString()), urls = allLinks.slice(0, limit);
    if (!urls.length) return res.status(200).json({ discoveredCount: allLinks.length, candidateCount: 0, attemptedCount: 0, failedCount: 0, duplicateCount: 0, products: [], warnings: ["ক্যাটাগরি পেজে বইয়ের detail link পাওয়া যায়নি; Rokomari block করতে পারে বা HTML বদলেছে।"] });
    const products = [], warnings = []; let failedCount = 0;
    for (const url of urls) {
      try {
        const page = await getHtml(url);
        const title = meta(page, ["og:title", "twitter:title"]) || field(page, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]);
        const imageUrl = absolute(meta(page, ["og:image", "twitter:image"]), url);
        const author = field(page, [/(?:লেখক|Author)[\s\S]{0,100}?<[^>]*>([\s\S]*?)<\/[^>]+>/i, /(?:লেখক|Author)\s*[:：]\s*([^<\n]{2,120})/i]);
        const publisher = field(page, [/(?:প্রকাশনী|প্রকাশক|Publisher)[\s\S]{0,100}?<[^>]*>([\s\S]*?)<\/[^>]+>/i, /(?:প্রকাশনী|প্রকাশক|Publisher)\s*[:：]\s*([^<\n]{2,120})/i]);
        const price = field(page, [/(?:বর্তমান মূল্য|দাম|Price)[\s\S]{0,100}?৳\s*([0-9,]+)/i, /৳\s*([0-9,]+)/]);
        products.push({ productName: title.replace(/\s*[|–-]\s*Rokomari.*$/i, "").trim(), author, publisher, imageUrl, currentPrice: price, previousPrice: "", originalProductUrl: url, isbn: "", shortDescription: "", sourceWebsite: "Rokomari", dataStatus: "পৃষ্ঠা থেকে সংগ্রহ করা—যাচাই প্রয়োজন" });
      } catch (e) { failedCount++; if (warnings.length < 5) warnings.push(String(e.message || e).slice(0, 180)); }
    }
    warnings.push("Export করার আগে বইয়ের নাম, লেখক, ছবি ও দাম preview-তে যাচাই করুন।");
    return res.status(200).json({ discoveredCount: allLinks.length, candidateCount: urls.length, attemptedCount: urls.length, failedCount, duplicateCount: 0, products, warnings });
  } catch (e) { return res.status(502).json({ error: "Rokomari থেকে সরাসরি তথ্য আনা যায়নি: " + String(e.message || e).slice(0, 350) }); }
};
