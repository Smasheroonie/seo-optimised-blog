/**
 * DELETE /api/blogs/:slug  — remove a published blog.
 * The slug is validated before it touches the storage layer.
 */
export default defineEventHandler(async event => {
  const slug = getRouterParam(event, 'slug') ?? ''
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid blog slug.' })
  }
  const storage = useStorage('blogs')
  const key = `${slug}.json`
  if (!(await storage.hasItem(key))) {
    throw createError({ statusCode: 404, statusMessage: 'Blog not found.' })
  }
  await storage.removeItem(key)
  return { deleted: slug }
})
