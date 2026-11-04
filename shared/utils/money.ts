/**
 * Parse human money strings into numbers: "£2.5m" -> 2_500_000,
 * "1,000,000" -> 1_000_000, "$120M" -> 120_000_000, "5bn" -> 5_000_000_000.
 * Returns null for anything that is not recognisably a quantity.
 * Shared so the client-side table sorting parses cells the same way the pipeline does.
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

/** Compact money for prose and stat cards: "£2.4bn", "$1.2m", "950,000". */
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
