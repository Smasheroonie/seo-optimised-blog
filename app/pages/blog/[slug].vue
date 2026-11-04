<script setup lang="ts">
import type { BlogData } from '#shared/types'
import { parseAmount, formatMoney } from '#shared/utils/money'

const route = useRoute()
const { data: blog } = await useFetch<BlogData | null>(`/api/blogs/${route.params.slug}`, { default: () => null })

if (!blog.value) {
  throw createError({ statusCode: 404, statusMessage: 'Blog not found', fatal: true })
}

const b = blog.value!

useSeoMeta({
  title: () => b.seo.title,
  description: () => b.seo.description,
  ogTitle: () => b.seo.title,
  ogDescription: () => b.seo.description,
  ogType: 'article',
  robots: 'index, follow',
})

const { siteUrl } = useRuntimeConfig().public

// Structured data: Article for the post, ItemList for the ranking table.
// The ItemList always reflects the canonical ranking order, whatever the
// reader has sorted the interactive table to show.
useHead({
  meta: [{ name: 'keywords', content: b.seo.keywords.join(', ') }],
  link: [{ rel: 'canonical', href: `${siteUrl}/blog/${b.slug}` }],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Article',
            headline: b.seo.title,
            description: b.seo.description,
            datePublished: b.createdAt,
            dateModified: b.createdAt,
            keywords: b.seo.keywords.join(', '),
          },
          {
            '@type': 'ItemList',
            name: b.seo.title,
            numberOfItems: b.table.rows.length,
            itemListElement: b.table.rows.slice(0, 20).map((row, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: row[1],
            })),
          },
        ],
      }),
    },
  ],
})

/* ------------------------------------------------------------------ */
/* Interactive ranking table: client-side sorting and pagination.      */
/* The full table ships in the SSR document, so search engines see     */
/* every row; sorting and paging are presentation-only concerns.       */
/* ------------------------------------------------------------------ */

const PAGE_SIZES = [10, 25, 50, 100]
const pageSize = ref(25)
const page = ref(1)
const sortColumn = ref<number | null>(null)
const sortDir = ref<'asc' | 'desc'>('asc')

// A column is numeric when at least 80% of its filled cells parse as quantities.
const columnTypes = computed<Array<'number' | 'text'>>(() => {
  return b.table.headers.map((_, j) => {
    let filled = 0
    let numeric = 0
    for (const row of b.table.rows) {
      const cell = (row[j] ?? '').trim()
      if (!cell || cell === '-') continue
      filled += 1
      if (parseAmount(cell) != null) numeric += 1
    }
    return filled > 0 && numeric / filled >= 0.8 ? 'number' : 'text'
  })
})

const sortedRows = computed(() => {
  const rows = [...b.table.rows]
  const col = sortColumn.value
  if (col == null) return rows
  const numeric = columnTypes.value[col] === 'number'
  const dir = sortDir.value === 'asc' ? 1 : -1
  return rows.sort((a, c) => {
    const av = (a[col] ?? '').trim()
    const cv = (c[col] ?? '').trim()
    if (numeric) {
      const an = parseAmount(av)
      const cn = parseAmount(cv)
      // Cells without a value always sort last, whichever way the column runs.
      if (an == null && cn == null) return 0
      if (an == null) return 1
      if (cn == null) return -1
      return (an - cn) * dir
    }
    return av.localeCompare(cv) * dir
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))

const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return sortedRows.value.slice(start, start + pageSize.value)
})

const rangeStart = computed(() => (page.value - 1) * pageSize.value + 1)
const rangeEnd = computed(() => Math.min(page.value * pageSize.value, sortedRows.value.length))

watch([sortColumn, sortDir, pageSize], () => {
  page.value = 1
})

function setSort(j: number) {
  if (sortColumn.value === j) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortColumn.value = j
    sortDir.value = 'asc'
  }
}

function sortLabel(j: number): 'ascending' | 'descending' | undefined {
  if (sortColumn.value !== j) return undefined
  return sortDir.value === 'asc' ? 'ascending' : 'descending'
}

function sortGlyph(j: number): string {
  if (sortColumn.value !== j) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

// Long-text columns (e.g. descriptions) are truncated in the table and
// expandable on click. A column qualifies when its cells run long on average,
// or any single cell does.
const TRUNCATE_AT = 30

const longColumns = computed<boolean[]>(() => {
  return b.table.headers.map((_, j) => {
    if (columnTypes.value[j] !== 'text') return false
    const cells = b.table.rows.map(r => (r[j] ?? '').trim()).filter(Boolean)
    if (!cells.length) return false
    const avg = cells.reduce((a, c) => a + c.length, 0) / cells.length
    const max = Math.max(...cells.map(c => c.length))
    return avg > 60 || max > 140
  })
})

// Stable identity per row (original table order), so an expanded cell stays
// expanded across pagination, sorting and paging.
const rowKeys = new Map<string[], number>()
b.table.rows.forEach((r, i) => rowKeys.set(r, i))

const expandedCells = ref<Record<string, boolean>>({})

function cellKey(row: string[], j: number): string {
  return `${rowKeys.get(row) ?? -1}-${j}`
}

function isExpanded(row: string[], j: number): boolean {
  return !!expandedCells.value[cellKey(row, j)]
}

function toggleCell(row: string[], j: number) {
  const key = cellKey(row, j)
  if (expandedCells.value[key]) delete expandedCells.value[key]
  else expandedCells.value[key] = true
}

const fmtStat = (n: number) => formatMoney(n, b.stats.currency)
</script>

<template>
  <main class="container">
    <article class="blog">
      <header class="blog-header">
        <p class="industry">{{ b.industry }} · {{ b.stats.rowCount }} companies ·
          {{ new Date(b.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }) }}</p>
        <h1>{{ b.seo.title }}</h1>
        <p class="intro">{{ b.content.intro }}</p>
      </header>

      <section v-if="b.stats.numeric" class="stats-grid" aria-label="Key statistics">
        <div class="stat-card">
          <span class="stat-value">{{ fmtStat(b.stats.numeric.total) }}</span>
          <span class="stat-label">Total across all {{ b.stats.rowCount }} companies</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ fmtStat(b.stats.numeric.mean) }}</span>
          <span class="stat-label">Average per company</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ fmtStat(b.stats.numeric.median) }}</span>
          <span class="stat-label">Median</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{{ fmtStat(b.stats.numeric.max) }}</span>
          <span class="stat-label">Largest single value</span>
        </div>
        <div v-if="b.stats.top10SharePct != null" class="stat-card">
          <span class="stat-value">{{ b.stats.top10SharePct }}%</span>
          <span class="stat-label">Held by the top 10</span>
        </div>
      </section>

      <section v-for="s in b.content.sections" :key="s.heading" class="blog-section">
        <h2>{{ s.heading }}</h2>
        <p>{{ s.paragraph }}</p>
      </section>

      <section class="ranking" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading">The Full Ranking</h2>

        <div class="table-controls">
          <p class="hint" aria-live="polite">
            Showing {{ rangeStart }}–{{ rangeEnd }} of {{ sortedRows.length }} companies
          </p>
          <label class="page-size">
            Rows per page
            <select v-model.number="pageSize">
              <option v-for="size in PAGE_SIZES" :key="size" :value="size">{{ size }}</option>
            </select>
          </label>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th v-for="(h, j) in b.table.headers" :key="h" scope="col" :aria-sort="sortLabel(j)">
                  <button type="button" class="th-sort" @click="setSort(j)">
                    {{ h }} <span aria-hidden="true" class="sort-glyph">{{ sortGlyph(j) }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in pagedRows" :key="rowKeys.get(row) ?? i">
                <td
                  v-for="(cell, j) in row"
                  :key="j"
                  :class="{ num: columnTypes[j] === 'number', 'cell-long': longColumns[j] }"
                >
                  <template v-if="longColumns[j] && cell.length > TRUNCATE_AT">
                    <button
                      type="button"
                      class="cell-toggle"
                      :aria-expanded="isExpanded(row, j)"
                      :title="cell"
                      @click="toggleCell(row, j)"
                    >
                      {{ isExpanded(row, j) ? cell : cell.slice(0, TRUNCATE_AT).trimEnd() + '…' }}
                    </button>
                  </template>
                  <template v-else>{{ cell }}</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <nav v-if="pageCount > 1" class="pagination" aria-label="Ranking table pages">
          <button type="button" class="btn page-btn" :disabled="page === 1" @click="page -= 1">‹ Previous</button>
          <span class="page-status">Page {{ page }} of {{ pageCount }}</span>
          <button type="button" class="btn page-btn" :disabled="page === pageCount" @click="page += 1">Next ›</button>
        </nav>
      </section>

      <footer v-if="b.content.conclusion" class="blog-conclusion">
        <p>{{ b.content.conclusion }}</p>
      </footer>
      <footer class="blog-meta">
        <p class="hint">
          Generated automatically from {{ b.source.filename }} ·
          copy: {{ b.source.generatedBy === 'gemini' ? `AI-generated and validated${b.source.model ? ` (${b.source.model})` : ''}` : 'deterministic template' }} ·
          statistics computed from the dataset, not from the AI.
        </p>
      </footer>
    </article>
  </main>
</template>
