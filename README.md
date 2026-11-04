# AI-Powered SEO Blog Generator

Turns a company dataset (CSV) into a server-rendered, SEO-optimised blog page. Built with
**Nuxt 4.6** as part of the Beauhurst Graduate/Junior Web Developer technical assessment.

Upload any industry's CSV through the web interface and the pipeline generates a new blog page
automatically: no code changes, no rebuilds.

## Architecture

Three layers, deliberately kept separate:

```
CSV dataset ──► 1. Parsing & schema detection  (server/utils/csv.ts)
                     │   Papa Parse, header-agnostic: detects the name column,
                     │   the ranking column and categorical columns from the data.
                     ▼
                2. Deterministic statistics    (server/utils/csv.ts)
                     │   Every number shown on the page is computed here in code.
                     │   The LLM never calculates anything.
                     ▼
                3. AI copy generation          (server/utils/gemini.ts)
                     │   Gemini writes prose only, from the pre-computed stats,
                     │   as validated JSON (schema-constrained). Output shape,
                     │   length and sanitisation are enforced in code.
                     │   If Gemini is unavailable or returns invalid output the
                     │   pipeline falls back to deterministic template prose,
                     │   so the demo never breaks.
                     ▼
                4. Storage                     (Nitro useStorage, fs driver)
                     │   One JSON document per blog, under .data/blogs/.
                     ▼
                5. Presentation                (app/pages/blog/[slug].vue)
                     Nuxt SSR template: intro, stat cards, analysis sections,
                     full ranking table. Same template serves any industry;
                     the dataset is data, not code.
```

Key decision: **data and presentation are fully decoupled.** The template renders a
`BlogData` JSON document; a blog is never "written into" the codebase.

## SEO features

- Fully server-rendered (Nuxt SSR): the content, table and statistics are in the initial HTML.
- `useSeoMeta` title, description, keywords and Open Graph tags per page.
- Canonical URL per page.
- JSON-LD structured data: `Article` plus `ItemList` for the ranking.
- Dynamic `sitemap.xml` (lists every generated blog) and `robots.txt`, both origin-aware.
- Semantic, accessible HTML: one `h1`, labelled sections, `scope="col"` table headers,
  visible focus states, mobile-first responsive layout.

## Interactive table and management

The ranking table is sortable by every column (numeric columns compare parsed
money values, text columns compare alphabetically, `aria-sort` kept in sync) and
paginated client-side (10/25/50/100 rows per page). Long-text cells such as
company descriptions are truncated at 90 characters and expand on click. The
full table still ships in the SSR HTML and the JSON-LD `ItemList` always
reflects the canonical ranking order, so search engines are unaffected by how a
reader sorts or pages.

Blogs can be deleted from the home page (`DELETE /api/blogs/:slug`, with a
confirmation step); the sitemap updates automatically because it is generated
from the same storage.

## Running locally

```bash
npm install
cp .env.example .env        # add your GEMINI_API_KEY (optional, see below)
npm run dev                 # http://localhost:3000
```

Upload `sample-data/fintech-sample.csv` (or your own CSV) on the home page. Try
`sample-data/healthtech-sample.csv` to see the same pipeline handle a different industry,
different columns and messier money formats ("$120M", "15,000,000", "£12.5m").

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | No | Google Gemini API key (free tier). Without it, or if the call fails, the pipeline uses deterministic template prose and marks the blog `template copy`. |
| `GEMINI_MODEL` | No | Model name, default `gemini-3.8-flash`. |
| `GEMINI_FALLBACK_MODELS` | No | Comma-separated older models tried in order when the primary model fails. Default `gemini-2.5-flash`. The model that produced a blog is recorded in its footer. |
| `NUXT_PUBLIC_SITE_URL` | In production | Public origin, used for canonical URLs, sitemap and robots.txt. |

Get a free key at [Google AI Studio](https://aistudio.google.com/apikey).

## Deployment

Deployed as a Nuxt SSR app (not a static build, because upload + generation are server-side).
Works on any Node-capable free host:

- **Vercel / Netlify**: connect the repo, set the environment variables, done.
- **Railway / Render free tier / Fly.io**: `npm ci && npm run build && node .output/server/index.mjs`.

Set `NUXT_PUBLIC_SITE_URL` to the deployed URL.

## Dependency security

`npm audit` reports **0 high/critical vulnerabilities**. The remaining low-severity advisories
sit exclusively in build-time tooling pulled in transitively by Nuxt/Nitro (`deepmerge` inside
`@rollup/plugin-node-resolve`, used at build time only). Two notes on this:

- The vulnerable packages (`deepmerge`, and `minimatch`/`glob` chains) never execute at
  runtime and are not reachable from HTTP input.
- No patched version of the `deepmerge` advisory exists at time of writing; npm's only
  suggested "fix" (`npm audit fix --force`) **downgrades Nuxt from 4.6 to 4.1**, trading a
  low-severity build-time advisory for an outdated framework with known-fixed issues.
  The vulnerable transitive packages that *do* have patches (`minimatch`, `glob`) are pinned
  via npm `overrides` in `package.json`.

## Known limitations (honest list)

- Storage is the filesystem of the deployed instance (`useStorage` fs driver). On ephemeral
  serverless hosts generated blogs can disappear between deployments; a V2 would move to a
  database or object store. On a long-lived Node host (Railway/Render/Fly) it persists.
- Generated blog slugs are unique but a re-upload of the same CSV creates a second page
  rather than updating the first. Uploading identical datasets twice will publish duplicates.
- AI output is schema-validated and sanitised, and it is instructed to cite only computed
  statistics, but there is no full semantic check that prose numbers match the dataset;
  the stats on the page are always computed in code, so the *data* cannot be hallucinated.
- No authentication on the upload endpoint: the demo is open by design. A production version
  would add auth and rate limiting before exposing generation to the internet.
- Gemini free-tier rate limits (~a few requests/minute) make this suitable for demos, not
  bulk generation; the V2 plan (queued generation, caching) addresses that.

## V2 sketch (hundreds to thousands of pages)

Queue-based generation (upload returns immediately, workers generate), database or object
storage instead of fs, incremental static regeneration / ISR for pages, sitemap sharding,
duplicate detection by dataset hash, and auth + rate limiting on the upload API.
