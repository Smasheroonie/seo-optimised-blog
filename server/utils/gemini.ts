import type { BlogContent, BlogSeo, DatasetStats } from '#shared/types'
import { formatMoney } from '#shared/utils/money'

/* ------------------------------------------------------------------ */
/* AI copy generation.                                                 */
/*                                                                     */
/* Design decision: the LLM writes prose only. Every statistic it may  */
/* reference is handed to it pre-computed, and it is instructed not to */
/* invent numbers. Its output is validated against a strict shape and  */
/* sanitised; on any failure the pipeline degrades to deterministic    */
/* template prose, so the demo never breaks (see README, "Reliability").*/
/* ------------------------------------------------------------------ */

const PROSE_SCHEMA = {
  type: 'object',
  properties: {
    industry: { type: 'string', description: 'A short human label for the industry, e.g. "UK Fintech"' },
    title: { type: 'string', description: 'SEO page title, max 60 characters' },
    metaDescription: { type: 'string', description: 'Meta description, max 155 characters' },
    keywords: { type: 'array', items: { type: 'string' }, description: '3-6 SEO keywords' },
    intro: { type: 'string', description: 'Two engaging introductory paragraphs as a single string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          paragraph: { type: 'string', description: 'One paragraph of analysis; may cite the given statistics' },
        },
        required: ['heading', 'paragraph'],
      },
    },
    conclusion: { type: 'string' },
  },
  required: ['industry', 'title', 'metaDescription', 'keywords', 'intro', 'sections', 'conclusion'],
}

const SYSTEM_PROMPT = `You are an SEO editor for a company-data publisher like Beauhurst.
You will receive pre-computed statistics, sample rows and a list of key insights from a dataset of companies.
Write original, engaging, factually grounded blog copy that would rank well in search engines.
Rules:
- Cite ONLY the statistics provided to you. Never invent, round or estimate any number.
- Write 3 to 5 sections, each with a specific, searchable heading.
- Your sections MUST discuss the provided key insights explicitly: what the top performers'
  combined share of the total implies about market concentration, what the gap between the
  mean and the median says about the distribution, and which category leads each breakdown.
- Do not name any company unless it appears in the provided top rankings.
- Write in British English, in a professional but readable tone.
- The title must be under 60 characters; the meta description under 155.`

/** Older models tried in order when the primary model fails. Overridable via GEMINI_FALLBACK_MODELS. */
const FALLBACK_MODELS = ['gemini-2.5-flash']

/** Resolve config at request time: runtimeConfig first (NUXT_-prefixed env vars map to it), then plain env vars. */
function resolveConfig(): { apiKey: string; model: string; fallbacks: string[] } {
  const config = useRuntimeConfig()
  const configured = (process.env.GEMINI_FALLBACK_MODELS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return {
    apiKey: config.geminiApiKey || process.env.GEMINI_API_KEY || '',
    model: config.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.8-flash',
    fallbacks: configured.length ? configured : FALLBACK_MODELS,
  }
}

/** Ask Gemini for the blog copy as validated JSON, falling back through older models. */
export async function generateProse(
  stats: DatasetStats,
  columns: string[],
  sampleRows: Record<string, string>[],
): Promise<{ seo: BlogSeo; content: BlogContent; industry: string; model: string }> {
  const { apiKey, model, fallbacks } = resolveConfig()
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey })

  const prompt = [
    SYSTEM_PROMPT,
    '',
    'Dataset columns: ' + columns.join(', '),
    'Pre-computed statistics (the only numbers you may reference):',
    JSON.stringify(stats, null, 2),
    buildInsights(stats),
    'Sample rows (context only, do not list these companies unless in top10):',
    JSON.stringify(sampleRows.slice(0, 5)),
  ].join('\n')

  // Try the primary model first, then each fallback in order. A failure of one
  // model (quota, deprecation, outage) never takes the pipeline down.
  const chain = [model, ...fallbacks.filter(m => m && m !== model)]
  const failures: string[] = []
  for (const candidate of chain) {
    try {
      const response = await ai.models.generateContent({
        model: candidate,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: PROSE_SCHEMA,
          temperature: 0.7,
        },
      })

      const raw = response.text
      if (!raw) throw new Error('Empty response from model')
      const parsed = JSON.parse(raw)
      const clean = validateProse(parsed)
      if (!clean) throw new Error('Model output failed validation')
      if (candidate !== chain[0]) {
        console.warn(`[gemini] primary model "${chain[0]}" unavailable; succeeded with fallback "${candidate}"`)
      }
      return { ...clean, model: candidate }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      failures.push(`${candidate}: ${reason}`)
      console.error(`[gemini] model "${candidate}" failed: ${reason}`)
    }
  }
  throw new Error(`All models failed (${chain.join(' -> ')}). ${failures.join('; ')}`)
}

/** Turn the computed statistics into an explicit list of insights the prose must cover. */
function buildInsights(stats: DatasetStats): string {
  const lines: string[] = ['Key insights your sections MUST discuss (cite these exact figures):']
  if (stats.numeric) {
    const fmt = (n: number) => formatMoney(n, stats.currency)
    lines.push(
      `- Total across all ${stats.rowCount} companies: ${fmt(stats.numeric.total)}; ` +
        `mean ${fmt(stats.numeric.mean)} vs median ${fmt(stats.numeric.median)} ` +
        `(a mean well above the median signals a small number of outsized companies).`,
    )
  }
  if (stats.top10SharePct != null) {
    lines.push(
      `- The top 10 companies account for ${stats.top10SharePct}% of the total ` +
        `(${stats.top10[0] ? `led by ${stats.top10[0].name}` : ''}).`,
    )
  }
  for (const bd of stats.breakdowns) {
    const leader = bd.groups[0]
    if (leader) {
      const total = leader.total ? ` with ${formatMoney(leader.total, stats.currency)}` : ''
      lines.push(`- Leading ${bd.label.toLowerCase()}: ${leader.label} (${leader.count} companies${total}).`)
    }
  }
  return lines.join('\n')
}

/** Strip markdown artefacts and collapse whitespace. The Vue layer escapes text anyway. */
function sanitiseText(s: unknown): string {
  return String(s ?? '')
    .replace(/[*#`_]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Validate and clamp the model output. Returns null if the shape is unusable. */
export function validateProse(parsed: unknown): { seo: BlogSeo; content: BlogContent; industry: string } | null {
  if (typeof parsed !== 'object' || parsed == null) return null
  const p = parsed as Record<string, unknown>

  const title = sanitiseText(p.title).slice(0, 70)
  const metaDescription = sanitiseText(p.metaDescription).slice(0, 160)
  const intro = sanitiseText(p.intro)
  const conclusion = sanitiseText(p.conclusion)
  const industry = sanitiseText(p.industry).slice(0, 60)
  if (!title || !metaDescription || !intro || !industry) return null

  if (!Array.isArray(p.sections) || !p.sections.length) return null
  const sections = (p.sections as unknown[])
    .map(s => {
      if (typeof s !== 'object' || s == null) return null
      const sec = s as Record<string, unknown>
      const heading = sanitiseText(sec.heading)
      const paragraph = sanitiseText(sec.paragraph)
      return heading && paragraph ? { heading, paragraph } : null
    })
    .filter((s): s is { heading: string; paragraph: string } => s != null)
    .slice(0, 6)
  if (!sections.length) return null

  const keywords = Array.isArray(p.keywords)
    ? p.keywords.map(k => sanitiseText(k)).filter(Boolean).slice(0, 6)
    : []

  return {
    industry,
    seo: { title, description: metaDescription, keywords },
    content: { intro, sections, conclusion: conclusion || '' },
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback: same shape, zero AI dependency.             */
/* ------------------------------------------------------------------ */

export function templateProse(stats: DatasetStats): { seo: BlogSeo; content: BlogContent; industry: string } {
  const industry = 'Company Analysis'
  const cur = stats.currency
  const fmt = (n: number) => formatMoney(n, cur)
  const title = `Top ${stats.rowCount} Companies Ranked by ${humanise(stats.amountColumn ?? 'Funding')}`
  const metaDescription =
    `Explore ${stats.rowCount} companies ranked by ${humanise(stats.amountColumn ?? 'funding')}` +
    (stats.numeric ? `, with ${fmt(stats.numeric.total)} in total and the top performers analysed.` : '.')

  const intro = [
    `This ranking covers ${stats.rowCount} companies` +
      (stats.amountColumn ? ` ordered by ${humanise(stats.amountColumn)}` : '') +
      `. The table below shows every entry with its key figures.`,
    stats.numeric
      ? `In total the dataset records ${fmt(stats.numeric.total)}, a mean of ${fmt(stats.numeric.mean)} and a median of ${fmt(stats.numeric.median)} per company, with the largest single value at ${fmt(stats.numeric.max)}.`
      : `The dataset contains ${stats.rowCount} companies across the categories shown below.`,
  ].join(' ')

  const sections: BlogSectionLite[] = []
  const top = stats.top10[0]
  if (stats.top10.length && top) {
    const nextTwo = stats.top10.slice(1, 3).map(c => `${c.name} (${fmt(c.value)})`).join(', ')
    sections.push({
      heading: 'The Top Performers',
      paragraph:
        `${top.name} leads the ranking at ${fmt(top.value)}, ` +
        `followed by ${nextTwo}. ` +
        `Together the top ten account for ${fmt(stats.top10.reduce((a, c) => a + c.value, 0))}.`,
    })
  }
  // Breakdowns are rendered as structured lists by the template, so the
  // fallback prose stays focused on the headline numbers.
  if (!sections.length) sections.push({ heading: 'Overview', paragraph: 'The full ranking is shown in the table below.' })

  const keywords = [
    `${industry.toLowerCase()} companies`,
    'company ranking',
    stats.amountColumn ? humanise(stats.amountColumn).toLowerCase() : 'company data',
    'industry analysis',
  ]

  return {
    industry,
    seo: { title: title.slice(0, 70), description: metaDescription.slice(0, 160), keywords },
    content: {
      intro,
      sections,
      conclusion: 'Browse the full ranking above to compare every company in the dataset.',
    },
  }
}

interface BlogSectionLite {
  heading: string
  paragraph: string
}
