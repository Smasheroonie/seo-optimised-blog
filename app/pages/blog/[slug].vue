<script setup lang="ts">
import type { BlogData } from '#shared/types'

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

const fmtStat = (n: number) => formatMoneyStat(n, b.stats.currency)
</script>

<script lang="ts">
// Small helper kept out of setup to keep the template readable.
function formatMoneyStat(n: number, currency: string): string {
  const abs = Math.abs(n)
  const sym = currency || ''
  const fmt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
  if (abs >= 1e9) return `${sym}${fmt.format(n / 1e9)}bn`
  if (abs >= 1e6) return `${sym}${fmt.format(n / 1e6)}m`
  if (abs >= 1e4) return `${sym}${fmt.format(n / 1e3)}k`
  return `${sym}${new Intl.NumberFormat('en-GB').format(n)}`
}
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
      </section>

      <section v-for="s in b.content.sections" :key="s.heading" class="blog-section">
        <h2>{{ s.heading }}</h2>
        <p>{{ s.paragraph }}</p>
      </section>

      <section class="ranking" aria-labelledby="ranking-heading">
        <h2 id="ranking-heading">The Full Ranking</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th v-for="h in b.table.headers" :key="h" scope="col">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in b.table.rows" :key="i">
                <td v-for="(cell, j) in row" :key="j" :class="{ num: j === 0 || (!!b.stats.currency && cell.startsWith(b.stats.currency)) }">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-for="bd in b.stats.breakdowns" :key="bd.column" class="breakdown" aria-labelledby="bd-heading">
        <h2>{{ bd.label }}</h2>
        <ul class="breakdown-list">
          <li v-for="g in bd.groups" :key="g.label">
            <strong>{{ g.label }}</strong>
            <span>{{ g.count }} companies{{ g.total ? ` · ${fmtStat(g.total)} total` : '' }}</span>
          </li>
        </ul>
      </section>

      <footer v-if="b.content.conclusion" class="blog-conclusion">
        <p>{{ b.content.conclusion }}</p>
      </footer>
      <footer class="blog-meta">
        <p class="hint">
          Generated automatically from {{ b.source.filename }} ·
          copy: {{ b.source.generatedBy === 'gemini' ? 'AI-generated and validated' : 'deterministic template' }} ·
          statistics computed from the dataset, not from the AI.
        </p>
      </footer>
    </article>
  </main>
</template>
