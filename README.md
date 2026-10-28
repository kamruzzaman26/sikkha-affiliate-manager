# Rokomari Firecrawl Category Importer (Next.js App Router)

This is a separate, experimental importer scaffold for the Sikkha Nogori Next.js project. It does not modify the existing affiliate product manager.

## What it does
- Accepts a Rokomari category URL.
- Calls Firecrawl v2 Map from a server route.
- Filters discovered Rokomari book detail URLs and reports map coverage honestly.
- Scrapes candidate detail pages through Firecrawl v2 `/scrape` with a structured JSON schema.
- Deduplicates by canonical product URL.
- Shows an editable preview and exports selected rows to CSV or JSON.
- Keeps `FIRECRAWL_API_KEY` on the server only.

## Limitations
- Firecrawl Map may return only a small number of URLs and may not discover category pagination. The UI reports discovered/attempted counts and does not claim complete coverage.
- Rokomari's actual URL patterns and Firecrawl's output must be tested with a valid API key before relying on results.
- This scaffold does not bypass CAPTCHA, access controls, robots rules, or anti-bot restrictions.
- It is not integrated into the existing manager yet.

## Install into project
Copy `app/rokomari-importer/page.tsx` and `app/api/rokomari-import/route.ts` into the project's App Router `src/app` folder:
- `src/app/rokomari-importer/page.tsx`
- `src/app/api/rokomari-import/route.ts`

If your project uses `app/` instead of `src/app/`, place the files under that directory instead.

Add this to `.env.local` (never commit this file):
```env
FIRECRAWL_API_KEY=fc-your-key-here
```

Check `.gitignore` contains:
```gitignore
.env*
!.env.example
```

Then run the dev server and visit `/rokomari-importer`.

## API behavior
`POST /api/rokomari-import` JSON body:
```json
{"categoryUrl":"https://www.rokomari.com/book/category/81/islamic-books","limit":20}
```
The limit is capped at 30 product pages per request. The route uses Firecrawl v2 `/map` and `/scrape`. It returns `products`, `discoveredCount`, `candidateCount`, `attemptedCount`, `failedCount`, and warnings.

## Before production
1. Test a small category with the real Firecrawl key.
2. Inspect returned links and confirm product URL matching.
3. Check whether Map discovers pagination. If not, add an explicitly tested pagination strategy based on real source links/markup rather than guessing page URLs.
4. Add authentication and rate limiting before exposing the API route publicly.
5. Review site terms, robots rules and Firecrawl plan/credit use.
