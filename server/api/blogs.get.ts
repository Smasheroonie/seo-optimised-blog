import type { BlogListItem } from '#shared/types'

/** GET /api/blogs - list generated blogs, newest first. */
export default defineEventHandler(async (): Promise<BlogListItem[]> => {
  return listBlogs()
})
