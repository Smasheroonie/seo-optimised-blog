<script setup lang="ts">
import type { BlogListItem } from '#shared/types'

useSeoMeta({
  title: 'DataBlog - AI-generated industry rankings',
  description:
    'Upload a company dataset and get a server-rendered, SEO-optimised blog page with ranking table and statistics, generated automatically.',
})

const { data: blogs, refresh } = await useFetch<BlogListItem[]>('/api/blogs', { default: () => [] })

const file = ref<File | null>(null)
const state = ref<'idle' | 'working' | 'error' | 'done'>('idle')
const result = ref<{ url: string; title: string; generatedBy: string; notice?: string; rows: number; amountColumn: string; currency: string } | null>(null)
const errorMsg = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

function pick(f: Event) {
  const target = f.target as HTMLInputElement
  file.value = target.files?.[0] ?? null
  state.value = 'idle'
}

const deleting = ref('')

async function removeBlog(slug: string, title: string) {
  if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return
  deleting.value = slug
  errorMsg.value = ''
  try {
    await $fetch(`/api/blogs/${slug}`, { method: 'DELETE' })
    await refresh()
  } catch (err: unknown) {
    const e = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value = e?.data?.statusMessage || e?.message || 'Delete failed.'
  } finally {
    deleting.value = ''
  }
}

async function submit() {
  if (!file.value) return
  state.value = 'working'
  errorMsg.value = ''
  try {
    const form = new FormData()
    form.append('file', file.value)
    const res = await $fetch.raw<{ url: string; title: string; generatedBy: string; rows: number; amountColumn: string; currency: string }>(
      '/api/blogs',
      { method: 'POST', body: form },
    )
    result.value = res._data ?? null
    state.value = 'done'
    await refresh()
  } catch (err: unknown) {
    state.value = 'error'
    const e = err as { data?: { statusMessage?: string }; message?: string }
    errorMsg.value = e?.data?.statusMessage || e?.message || 'Upload failed.'
  }
}
</script>

<template>
  <main class="container">
    <section class="hero">
      <h1>Turn a company dataset into an SEO-optimised blog</h1>
      <p>
        Upload a CSV of companies (any industry, any column names). The pipeline detects the schema, computes
        every statistic deterministically, has an LLM write the prose, and publishes a server-rendered,
        search-engine-friendly page. No code changes, no rebuilds.
      </p>
    </section>

    <section class="card upload-card" aria-labelledby="upload-heading">
      <h2 id="upload-heading">Generate a new blog</h2>
      <form class="upload-form" @submit.prevent="submit">
        <label class="visually-hidden" for="csv">CSV dataset</label>
        <input ref="inputEl" id="csv" type="file" accept=".csv,text/csv" @change="pick" />
        <button type="submit" class="btn" :disabled="!file || state === 'working'">
          {{ state === 'working' ? 'Generating…' : 'Generate blog' }}
        </button>
      </form>
      <p class="hint">Needs a header row, a company-name-like column and a numeric column to rank by (max 5 MB).</p>

      <p v-if="state === 'error'" class="error" role="alert">{{ errorMsg }}</p>

      <div v-if="state === 'done' && result" class="success">
        <p>
          Created <strong>{{ result.title }}</strong> from {{ result.rows }} rows
          ({{ result.generatedBy === 'gemini' ? 'AI copy' : 'template copy' }};
          ranking column: {{ result.amountColumn }}{{ result.currency !== 'none detected' ? `, currency ${result.currency}` : '' }}).
        </p>
        <p v-if="result.notice" class="hint">{{ result.notice }}</p>
        <NuxtLink :to="result.url" class="btn">View the blog page</NuxtLink>
      </div>
    </section>

    <section aria-labelledby="blogs-heading">
      <h2 id="blogs-heading">Published blogs</h2>
      <p v-if="!blogs.length" class="hint">Nothing published yet. Upload a CSV above to generate the first page.</p>
      <ul v-else class="blog-list">
        <li v-for="b in blogs" :key="b.slug">
          <div class="blog-list-main">
            <NuxtLink :to="`/blog/${b.slug}`">{{ b.title }}</NuxtLink>
            <span class="meta">
              {{ b.industry }} · {{ b.rows }} companies ·
              {{ b.generatedBy === 'gemini' ? 'AI-generated copy' : 'template copy' }} ·
              {{ new Date(b.createdAt).toLocaleDateString('en-GB') }}
            </span>
          </div>
          <button
            type="button"
            class="btn btn-danger"
            :disabled="deleting === b.slug"
            :aria-label="`Delete ${b.title}`"
            @click="removeBlog(b.slug, b.title)"
          >
            {{ deleting === b.slug ? 'Deleting…' : 'Delete' }}
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>
