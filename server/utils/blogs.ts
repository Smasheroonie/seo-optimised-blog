import type { BlogData, BlogListItem, TableData } from '#shared/types'
import { parseAmount, formatMoneyExact } from '#shared/utils/money'

/** Slugs are safe for URLs and filesystem keys. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'blog'
}

/** Build the full ranking table: sorted, ranked, human-readable. */
export function buildTable(
  headers: string[],
  rows: Record<string, string>[],
  nameColumn: string,
  amountColumn: string | null,
  currency: string,
  extraColumns: string[],
): TableData {
  const shown = extraColumns.slice(0, 5)
  const tableHeaders = ['Rank', nameColumn, ...(amountColumn ? [amountColumn] : []), ...shown]
  const sorted = [...rows].sort((a, b) => {
    if (!amountColumn) return 0
    const av = parseAmount(a[amountColumn!]) ?? -1
    const bv = parseAmount(b[amountColumn!]) ?? -1
    return bv - av
  })
  const tableRows = sorted.map((r, i) => {
    const cells = [String(i + 1), (r[nameColumn] ?? '').trim()]
    if (amountColumn) {
      const v = parseAmount(r[amountColumn])
      cells.push(v != null ? formatMoneyExact(v, currency) : String(r[amountColumn] ?? '').trim() || '-')
    }
    for (const col of shown) cells.push((r[col] ?? '').trim())
    return cells
  })
  return { headers: tableHeaders.map(humanise), rows: tableRows }
}

/** Read one blog document, or null. */
export async function getBlog(slug: string): Promise<BlogData | null> {
  return (await useStorage('blogs').getItem<BlogData>(`${slug}.json`)) ?? null
}

export async function listBlogs(): Promise<BlogListItem[]> {
  const keys = await useStorage('blogs').getKeys()
  const items = await Promise.all(keys.map(k => useStorage('blogs').getItem<BlogData>(k)))
  return items
    .filter((b): b is BlogData => b != null)
    .map(b => ({
      slug: b.slug,
      title: b.seo.title,
      industry: b.industry,
      createdAt: b.createdAt,
      rows: b.stats.rowCount,
      generatedBy: b.source.generatedBy,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Store a blog under a unique slug. */
export async function saveBlog(blog: BlogData): Promise<string> {
  let slug = blog.slug
  let n = 1
  while (await getBlog(slug)) {
    n += 1
    slug = `${blog.slug}-${n}`
  }
  blog.slug = slug
  await useStorage('blogs').setItem(`${slug}.json`, blog)
  return slug
}
