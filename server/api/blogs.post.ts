import type { BlogData } from '#shared/types'

/**
 * POST /api/blogs  (multipart/form-data with a `file` field, or raw CSV body)
 *
 * The core pipeline: CSV upload -> schema detection -> deterministic stats ->
 * LLM prose (validated, with template fallback) -> stored blog document.
 * Nothing here is fintech-specific; the same route serves any industry CSV.
 */
export default defineEventHandler(async event => {
  const filename = (getHeader(event, 'x-filename') || 'dataset.csv').replace(/[^a-zA-Z0-9._-]/g, '_')
  let csv: string | undefined

  const contentType = getHeader(event, 'content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const parts = await readMultipartFormData(event)
    const file = Array.isArray(parts)
      ? parts?.find(p => p.name === 'file' || p.type?.includes('csv') || p.filename?.endsWith('.csv'))
      : undefined
    if (!file?.data?.length) throw createError({ statusCode: 400, statusMessage: 'No CSV file in upload.' })
    csv = file.data.toString('utf-8')
  } else {
    csv = await readRawBody(event, 'utf-8').catch(() => undefined)
  }
  if (!csv?.trim()) throw createError({ statusCode: 400, statusMessage: 'Empty upload.' })
  if (csv.length > 5_000_000) throw createError({ statusCode: 413, statusMessage: 'File too large (max 5 MB).' })

  // 1. Parse and detect the schema from the data itself.
  const dataset = parseCsv(csv)
  if (dataset.rows.length < 3) {
    throw createError({ statusCode: 400, statusMessage: 'Dataset needs at least 3 rows.' })
  }
  const schema = detectSchema(dataset)
  if (!schema.amountColumn) {
    throw createError({
      statusCode: 422,
      statusMessage:
        'Could not find a numeric column to rank by. Include a column of money or quantity values (e.g. "Total Funds Raised").',
    })
  }

  // 2. Compute every statistic deterministically.
  const stats = computeStats(dataset, schema)

  // 3. AI copy, validated; deterministic template on any failure.
  let generatedBy: BlogData['source']['generatedBy'] = 'gemini'
  let notice: string | undefined
  let prose: { seo: BlogData['seo']; content: BlogData['content']; industry: string; model?: string }
  try {
    prose = await generateProse(stats, dataset.headers, dataset.rows)
  } catch (err) {
    // Always visible in server logs: a silent fallback hid a config bug once already.
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[blogs.post] AI generation failed, using template fallback:', reason)
    prose = templateProse(stats)
    generatedBy = 'template'
    notice = `AI copy failed, used template copy instead. Reason: ${reason}`
  }

  // 4. Assemble and store the blog document. Table columns: categorical
  // breakdowns first, then every remaining column (Employees, Website,
  // Description...), so nothing in the dataset is hidden from the reader.
  // The table already generates its own Rank column, so a rank column in
  // the source data is not repeated.
  const extraColumns = [...schema.categoricalColumns]
  for (const h of dataset.headers) {
    if (h === schema.nameColumn || h === schema.amountColumn) continue
    if (extraColumns.includes(h) || /^rank$/i.test(h.trim())) continue
    extraColumns.push(h)
  }
  const blog: BlogData = {
    slug: slugify(prose.seo.title),
    createdAt: new Date().toISOString(),
    industry: prose.industry,
    source: { filename, rows: dataset.rows.length, generatedBy, model: prose.model },
    seo: prose.seo,
    content: prose.content,
    stats,
    table: buildTable(
      dataset.headers,
      dataset.rows,
      schema.nameColumn,
      schema.amountColumn,
      schema.currency,
      extraColumns,
    ),
  }

  const slug = await saveBlog(blog)

  setResponseStatus(event, 201)
  return {
    slug,
    url: `/blog/${slug}`,
    title: blog.seo.title,
    generatedBy,
    notice,
    rows: dataset.rows.length,
    amountColumn: schema.amountColumn,
    currency: schema.currency || 'none detected',
  }
})
