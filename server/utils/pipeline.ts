import type { BlogData } from '#shared/types'

/**
 * The core pipeline, shared by the upload endpoint and the startup seeder:
 * CSV -> schema detection -> deterministic stats -> AI copy (validated, with
 * template fallback) -> stored blog document. Nothing here is industry-
 * specific; the same function serves any dataset.
 */
export async function createBlogFromCsv(
  csv: string,
  filename: string,
  industryOverride?: string,
): Promise<{ blog: BlogData; notice?: string }> {
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

  // 3. Industry label: an explicit user choice wins; otherwise it is inferred
  //    from the data itself (category column, then keyword scan, then the
  //    filename only as a weak last resort). The AI may refine a data-inferred
  //    label but must use an explicit one as given.
  const override = industryOverride?.trim()
  const inferred = override || inferIndustry(dataset.headers, dataset.rows, filename) || ''

  // 4. AI copy, validated; deterministic template on any failure.
  let generatedBy: BlogData['source']['generatedBy'] = 'gemini'
  let notice: string | undefined
  let prose: { seo: BlogData['seo']; content: BlogData['content']; industry: string; model?: string }
  try {
    prose = await generateProse(stats, dataset.headers, dataset.rows, inferred || undefined, !!override)
  } catch (err) {
    // Always visible in server logs: a silent fallback hid a config bug once already.
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] AI generation failed, using template fallback:', reason)
    prose = templateProse(stats, inferred || undefined)
    generatedBy = 'template'
    notice = `AI copy failed, used template copy instead. Reason: ${reason}`
  }
  // If the model skipped or garbled the FAQ, the deterministic one fills in,
  // so the section and its structured data are always complete.
  if (!prose.content.faq.length) prose.content.faq = templateFaq(stats)
  if (override) prose.industry = override

  // 5. Assemble and store the blog document. Table columns: categorical
  //    breakdowns first, then every remaining column (Employees, Website,
  //    Description...), so nothing in the dataset is hidden from the reader.
  //    The table already generates its own Rank column, so a rank column in
  //    the source data is not repeated.
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

  await saveBlog(blog)
  return { blog, notice }
}
