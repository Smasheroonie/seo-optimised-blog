/** GET /api/blogs/:slug - one generated blog document, or 404. */
export default defineEventHandler(async event => {
  const slug = getRouterParam(event, 'slug') ?? ''
  const blog = await getBlog(slug)
  if (!blog) throw createError({ statusCode: 404, statusMessage: 'Blog not found.' })
  return blog
})
