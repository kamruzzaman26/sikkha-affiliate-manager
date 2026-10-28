import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
const ALLOWED_HOSTS = new Set(["www.rokomari.com", "rokomari.com"]);
const PRODUCT_PATH = /^\/book\/[^/]+\/\d+(?:\/|$)/i;

type FirecrawlLink = { url?: string; title?: string; description?: string };
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

const productSchema = {
  type: "object",
  properties: {
    productName: { type: "string", description: "Exact book title shown on the product page" },
    author: { type: "string", description: "Author name, only if explicitly present" },
    imageUrl: { type: "string", description: "Main book cover image URL, if present" },
    currentPrice: { type: "string", description: "Current selling price exactly as displayed" },
    previousPrice: { type: "string", description: "Previous/list price if explicitly shown" },
    publisher: { type: "string", description: "Publisher, if explicitly shown" },
    isbn: { type: "string", description: "ISBN only if explicitly shown" },
    shortDescription: { type: "string", description: "Brief description, if present" }
  },
  required: ["productName", "author", "imageUrl", "currentPrice", "previousPrice", "publisher", "isbn", "shortDescription"],
  additionalProperties: false
};

function validateCategoryUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!url.pathname.startsWith("/book/category/")) return null;
    return url;
  } catch {
    return null;
  }
}

async function firecrawl(path: string, body: unknown, apiKey: string) {
  const response = await fetch(`${FIRECRAWL_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `Firecrawl returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function normalizeProductUrl(raw: string, categoryUrl: URL): string | null {
  try {
    const url = new URL(raw, categoryUrl);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (!PRODUCT_PATH.test(url.pathname)) return null;
    if (url.pathname.startsWith("/book/category/")) return null;
    // Remove tracking parameters only; preserve product-identifying query parameters.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function cleanString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function readExtractedJson(data: any): any {
  if (!data || typeof data !== "object") return {};
  if (data.json && typeof data.json === "object") return data.json;
  if (data.extract && typeof data.extract === "object") return data.extract;
  return {};
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server-এ FIRECRAWL_API_KEY সেট করা নেই। .env.local-এ key যোগ করে dev server restart করো।" },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body বৈধ JSON নয়।" }, { status: 400 });
  }

  const categoryUrl = validateCategoryUrl(body?.categoryUrl);
  if (!categoryUrl) {
    return NextResponse.json(
      { error: "শুধু HTTPS Rokomari book category URL দাও, যেমন /book/category/81/islamic-books।" },
      { status: 400 }
    );
  }

  const requestedLimit = Number(body?.limit ?? 20);
  const limit = Number.isFinite(requestedLimit) ? Math.min(30, Math.max(1, Math.floor(requestedLimit))) : 20;
  const warnings: string[] = [];

  try {
    // Map discovers URLs; it does not guarantee full category/pagination coverage.
    const mapResult = await firecrawl("/map", {
      url: categoryUrl.toString(),
      limit: 500,
      sitemap: "include",
      includeSubdomains: false
    }, apiKey);

    const links: FirecrawlLink[] = Array.isArray(mapResult?.links) ? mapResult.links : [];
    const candidates = [...new Set(
      links.map(link => typeof link?.url === "string" ? normalizeProductUrl(link.url, categoryUrl) : null)
        .filter((url): url is string => Boolean(url))
    )].slice(0, limit);

    if (!links.length) warnings.push("Firecrawl Map কোনো link ফেরত দেয়নি।");
    if (links.length <= 1) warnings.push("Map-এ খুব কম link এসেছে; পুরো category পাওয়া গেছে ধরে নেওয়া যাবে না।");
    if (candidates.length === 0) warnings.push("Map response থেকে matching book detail URL পাওয়া যায়নি। Product URL pattern যাচাই করতে হবে।");
    if (candidates.length === limit) warnings.push(`এই run-এ সর্বোচ্চ ${limit}টি product page-এর সীমা প্রয়োগ করা হয়েছে।`);

    const products: Product[] = [];
    let failedCount = 0;

    // Sequential calls limit request bursts and make failures easier to report.
    for (const productUrl of candidates) {
      try {
        const scrapeResult = await firecrawl("/scrape", {
          url: productUrl,
          onlyMainContent: true,
          formats: [{
            type: "json",
            prompt: "Extract only facts explicitly visible on this product page. Do not guess missing values. Return empty strings for missing fields.",
            schema: productSchema
          }]
        }, apiKey);

        const extracted = readExtractedJson(scrapeResult?.data);
        const metadata = scrapeResult?.data?.metadata ?? {};
        const title = cleanString(extracted.productName) || cleanString(metadata.title);
        const imageUrl = cleanString(extracted.imageUrl);
        let safeImage = "";
        try {
          const parsedImage = new URL(imageUrl);
          if (parsedImage.protocol === "https:" || parsedImage.protocol === "http:") safeImage = parsedImage.toString();
        } catch {}

        products.push({
          productName: title,
          author: cleanString(extracted.author),
          imageUrl: safeImage,
          currentPrice: cleanString(extracted.currentPrice),
          previousPrice: cleanString(extracted.previousPrice),
          originalProductUrl: productUrl,
          publisher: cleanString(extracted.publisher),
          isbn: cleanString(extracted.isbn),
          shortDescription: cleanString(extracted.shortDescription),
          sourceWebsite: "Rokomari",
          dataStatus: title && (cleanString(extracted.currentPrice) || safeImage) ? "partial" : "needs_review"
        });
      } catch {
        failedCount++;
        products.push({
          productName: "",
          author: "",
          imageUrl: "",
          currentPrice: "",
          previousPrice: "",
          originalProductUrl: productUrl,
          publisher: "",
          isbn: "",
          shortDescription: "",
          sourceWebsite: "Rokomari",
          dataStatus: "needs_review"
        });
      }
    }

    const unique = new Map<string, Product>();
    for (const product of products) {
      if (!unique.has(product.originalProductUrl)) unique.set(product.originalProductUrl, product);
    }

    if (failedCount) warnings.push(`${failedCount}টি product page scrape করতে ব্যর্থ হয়েছে; সংশ্লিষ্ট row review করতে হবে।`);
    warnings.push("Map result-এ pagination coverage যাচাই না হওয়া পর্যন্ত এটি সম্পূর্ণ category export নয়।");

    return NextResponse.json({
      success: true,
      categoryUrl: categoryUrl.toString(),
      discoveredCount: links.length,
      candidateCount: candidates.length,
      attemptedCount: products.length,
      failedCount,
      duplicateCount: products.length - unique.size,
      coverage: "partial_unverified",
      warnings,
      products: [...unique.values()]
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Firecrawl request ব্যর্থ হয়েছে।";
    return NextResponse.json({
      error: `Firecrawl request ব্যর্থ: ${message}`,
      hint: "API key, credits, network, Rokomari access এবং Firecrawl response যাচাই করো।"
    }, { status: 502 });
  }
}
