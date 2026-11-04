import Papa from 'papaparse'
import type { DatasetStats, NumericSummary, CategorySummary, GroupSummary } from '#shared/types'

export interface ParsedDataset {
  headers: string[]
  rows: Record<string, string>[]
}

/** Parse CSV text into rows. Quotes, commas-in-fields and escaped cells are handled by Papa Parse. */
export function parseCsv(text: string): ParsedDataset {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: h => h.trim(),
  })
  if (result.errors.length && !result.data.length) {
    const first = result.errors[0]
    throw new Error(`CSV could not be parsed: ${first?.message ?? 'unknown parse error'}`)
  }
  const headers = result.meta.fields?.filter(Boolean) ?? []
  if (!headers.length) throw new Error('CSV has no header row.')
  if (headers.length < 2) throw new Error('CSV needs at least two columns (a company name and a value).')
  return { headers, rows: result.data }
}

/* ------------------------------------------------------------------ */
/* Schema detection: the pipeline never assumes fintech column names.  */
/* ------------------------------------------------------------------ */

const NAME_PATTERNS: [RegExp, number][] = [
  [/^(company|organisation|organization|business|startup|firm)$/, 100],
  [/(company|organisation|organization|business|firm)/, 80],
  [/^(name|title)$/, 70],
  [/(name|title)/, 50],
]

const AMOUNT_HEADER_HINTS =
  /fundrais|raised|funding|investment|invested|valuation|revenue|turnover|amount|capital|total|value|funds/

/** Normalise a header for comparison: lowercase, alphanumerics only. */
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Parse human money strings into numbers: "£2.5m" -> 2_500_000,
 * "1,000,000" -> 1_000_000, "$120M" -> 120_000_000, "5bn" -> 5_000_000_000.
 * Returns null for anything that is not recognisably a quantity.
 */
export function parseAmount(raw: unknown): number | null {
  if (raw == null) return null
  let s = String(raw).trim()
  if (!s) return null
  s = s.replace(/[,\s_]/g, '')
  s = s.replace(/gbp|usd|eur/gi, '')

  const m = s.match(/^([^0-9.eE+-]*)([-+]?[0-9]+(?:\.[0-9]+)?)([^0-9.]*)$/)
  if (!m) return null
  const numStr = m[2] ?? ''
  const suffix = m[3] ?? ''
  let n = Number(numStr)
  if (!Number.isFinite(n) || n < 0) return null

  const suf = suffix.toLowerCase()
  if (/^(k|kb|thousand)$/.test(suf)) n *= 1e3
  else if (/^(m|mm|mn|mln|million)$/.test(suf)) n *= 1e6
  else if (/^(b|bn|bil|billion)$/.test(suf)) n *= 1e9
  else if (/^(t|tn|trillion)$/.test(suf)) n *= 1e12
  else if (suf) return null
  return n
}

/** Detect the currency most common across raw amount strings ("£", "$", "€" or a code). */
export function detectCurrency(raws: string[]): string {
  const counts = new Map<string, number>()
  for (const raw of raws) {
    const s = String(raw ?? '')
    const m = s.match(/^(gbp|usd|eur)|^(£|\$|€)/i)
    if (!m) continue
    const token = (m[1] ?? m[2] ?? '').toUpperCase()
    const symbol = token.startsWith('G')
      ? '£'
      : token.startsWith('U')
        ? '$'
        : token.startsWith('E') && token.length > 1
          ? '€'
          : token
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
  }
  let best = ''
  let bestN = 0
  for (const [symbol, n] of counts) {
    if (n > bestN) {
      best = symbol
      bestN = n
    }
  }
  return best
}

export interface DatasetSchema {
  nameColumn: string
  amountColumn: string | null
  /** Non-name, non-amount columns worth breaking down by category. */
  categoricalColumns: string[]
  currency: string
}

/**
 * Work out which column holds names, which holds amounts and which are
 * categorical, from the data itself rather than hardcoded fintech headers.
 */
export function detectSchema(dataset: ParsedDataset): DatasetSchema {
  const { headers, rows } = dataset

  // Name column: score candidate headers by pattern match.
  let nameColumn: string = headers[0] ?? ''
  let nameScore = 0
  for (const h of headers) {
    const n = norm(h)
    for (const [re, score] of NAME_PATTERNS) {
      if (re.test(n) && score > nameScore) {
        nameColumn = h
        nameScore = score
      }
    }
  }

  // Amount column: prefer hinted headers where >=half the values parse as money.
  const parseable = new Map<string, number>()
  for (const h of headers) {
    if (h === nameColumn) continue
    const ok = rows.filter(r => parseAmount(r[h]) != null).length
    parseable.set(h, rows.length ? ok / rows.length : 0)
  }
  let amountColumn: string | null = null
  let bestHint = 0
  for (const [h, frac] of parseable) {
    if (frac < 0.5) continue
    const hint = AMOUNT_HEADER_HINTS.test(norm(h)) ? 2 : 1
    const score = hint * 10 + frac
    if (hint >= 1 && score > bestHint) {
      amountColumn = h
      bestHint = score
    }
  }

  // Categorical columns: remaining columns with a manageable number of distinct values.
  const categoricalColumns: string[] = []
  for (const h of headers) {
    if (h === nameColumn || h === amountColumn) continue
    const values = rows.map(r => (r[h] ?? '').trim()).filter(Boolean)
    const distinct = new Set(values).size
    if (values.length && distinct <= Math.max(30, values.length * 0.6)) {
      categoricalColumns.push(h)
    }
  }

  const currency = amountColumn
    ? detectCurrency(rows.map(r => r[amountColumn]).filter(Boolean) as string[])
    : ''

  return { nameColumn, amountColumn, categoricalColumns, currency }
}

/* ------------------------------------------------------------------ */
/* Stats: every number on the page is computed here, deterministically. */
/* The LLM never calculates anything.                                  */
/* ------------------------------------------------------------------ */

export function computeStats(dataset: ParsedDataset, schema: DatasetSchema): DatasetStats {
  const { rows } = dataset
  const { nameColumn, amountColumn, currency } = schema

  const values = amountColumn
    ? rows.map(r => parseAmount(r[amountColumn!])).filter((v): v is number => v != null)
    : []

  let numeric: NumericSummary | null = null
  if (values.length) {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median = sorted.length % 2
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    numeric = {
      count: rows.length,
      withAmount: values.length,
      total: values.reduce((a, b) => a + b, 0),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      median,
      max: sorted[sorted.length - 1] ?? 0,
    }
  }

  const top10 = amountColumn
    ? [...rows]
        .map(r => ({ name: (r[nameColumn] ?? '').trim(), value: parseAmount(r[amountColumn!]) ?? -1 }))
        .filter(r => r.name && r.value >= 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
        .map((r, i) => ({ rank: i + 1, name: r.name, value: r.value }))
    : []

  const breakdowns: CategorySummary[] = schema.categoricalColumns.map(column => {
    const totals = new Map<string, { count: number; total: number }>()
    for (const r of rows) {
      const label = (r[column] ?? '').trim()
      if (!label) continue
      const entry = totals.get(label) ?? { count: 0, total: 0 }
      entry.count += 1
      const v = amountColumn ? parseAmount(r[amountColumn!]) : null
      if (v != null) entry.total += v
      totals.set(label, entry)
    }
    const groups: GroupSummary[] = [...totals.entries()]
      .map(([label, g]) => ({ label, count: g.count, total: g.total }))
      .sort((a, b) => b.total - a.total || b.count - a.count)
      .slice(0, 5)
    return { column, label: humanise(column), groups }
  })

  return {
    rowCount: rows.length,
    currency,
    nameColumn,
    amountColumn,
    numeric,
    top10,
    breakdowns,
  }
}

/** "TotalFundsRaised" -> "Total Funds Raised" */
export function humanise(header: string): string {
  return header
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Compact money for prose and cards: "£2.4bn", "$1.2m", "950,000". */
export function formatMoney(n: number, currency = ''): string {
  const abs = Math.abs(n)
  const sym = currency || ''
  const fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
  if (abs >= 1e9) return `${sym}${fmt.format(n / 1e9)}bn`
  if (abs >= 1e6) return `${sym}${fmt.format(n / 1e6)}m`
  if (abs >= 1e4) return `${sym}${fmt.format(n / 1e3)}k`
  return `${sym}${new Intl.NumberFormat('en-GB').format(n)}`
}

/** Exact money for the ranking table. */
export function formatMoneyExact(n: number, currency = ''): string {
  return `${currency}${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(n)}`
}
