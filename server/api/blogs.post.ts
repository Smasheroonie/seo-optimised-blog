import type { BlogData } from '#shared/types'

/**
 * POST /api/blogs  (multipart/form-data with a `file` field, or raw CSV body)
 *
 * Thin endpoint: validation of the upload, then the shared pipeline
 * (server/utils/pipeline.ts) does the work. The same pipeline seeds the
 * example blog at startup, so the demo path and the user path cannot drift.
 */
export default defineEventHandler(async event => {
  const filename = (getHeader(event, 'x-filename') || 'dataset.csv').replace(/[^a-zA-Z0-9._-]/g, '_')
  let csv: string | undefined
  let industry: string | undefined

  const contentType = getHeader(event, 'content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const parts = await readMultipartFormData(event)
    if (!Array.isArray(parts) || !parts.length) {
      throw createError({ statusCode: 400, statusMessage: 'No CSV file in upload.' })
    }
    const file = parts.find(p => p.name === 'file' || p.type?.includes('csv') || p.filename?.endsWith('.csv'))
    if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'No CSV file in upload.' })
    csv = file.data.toString('utf-8')
    industry = parts.find(p => p.name === 'industry')?.data.toString('utf-8').trim() || undefined
  } else {
    csv = await readRawBody(event, 'utf-8').catch(() => undefined)
  }
  if (!csv?.trim()) throw createError({ statusCode: 400, statusMessage: 'Empty upload.' })
  if (csv.length > 5_000_000) throw createError({ statusCode: 413, statusMessage: 'File too large (max 5 MB).' })

  const { blog, notice } = await createBlogFromCsv(csv, filename, industry)

  setResponseStatus(event, 201)
  return {
    slug: blog.slug,
    url: `/blog/${blog.slug}`,
    title: blog.seo.title,
    industry: blog.industry,
    generatedBy: blog.source.generatedBy,
    notice,
    rows: blog.stats.rowCount,
    amountColumn: blog.stats.amountColumn,
    currency: blog.stats.currency || 'none detected',
  } satisfies {
    slug: string
    url: string
    title: string
    industry: string
    generatedBy: BlogData['source']['generatedBy']
    notice?: string
    rows: number
    amountColumn: string | null
    currency: string
  }
})
