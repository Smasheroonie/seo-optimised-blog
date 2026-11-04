import type { BlogListItem } from '#shared/types'

/** Dynamic sitemap listing the home page and every generated blog. */
export default defineEventHandler(async event => {
  const { siteUrl } = useRuntimeConfig().public
  const blogs = (await useStorage('blogs').getKeys()).length
    ? await listBlogs()
    : ([] as BlogListItem[])

  const urls = [
    { loc: `${siteUrl}/`, changefreq: 'weekly', priority: 1.0 },
    ...blogs.map(b => ({ loc: `${siteUrl}/blog/${b.slug}`, changefreq: 'monthly', priority: 0.8 })),
  ]
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(u => `  <url><loc>${u.loc}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`)
      .join('\n') +
    `\n</urlset>`
  setHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return xml
})
