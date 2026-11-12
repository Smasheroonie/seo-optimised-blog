/**
 * Seed the example blog at server startup whenever it is absent.
 *
 * Generated blogs live in the storage layer, which is ephemeral on hosts
 * like Render (wiped on redeploy or spin-down) — a reviewer opening the
 * deployed app could otherwise find an empty index. Running the exact same
 * pipeline as the upload endpoint (template fallback included) means the
 * fintech example is always present, generated, never hardcoded, and the
 * seed path cannot drift from the user path.
 *
 * The sample CSV is bundled into the build through Nitro's serverAssets
 * (see nuxt.config.ts), so it is available whatever the runtime filesystem.
 */
export default defineNitroPlugin(() => {
  // Fire-and-forget: the server starts listening immediately and the home
  // page shows a "preparing" state (with polling) until the example lands,
  // instead of the first request blocking on a Gemini call.
  void seedExample()
})

async function seedExample(): Promise<void> {
  try {
    const store = useStorage('blogs')
    // Seed whenever the example blog itself is absent, whatever else is in
    // the store: leftover uploads from a previous session should not stop
    // the example from being (re)generated.
    const keys = await store.getKeys()
    for (const key of keys) {
      const blog = await store.getItem<{ source?: { filename?: string } }>(key)
      if (blog?.source?.filename === 'fintech-sample.csv') return
    }
    const csv = await useStorage('assets').getItem<string>('samples/fintech-sample.csv')
    if (!csv) throw new Error('bundled sample dataset missing')
    const { blog } = await createBlogFromCsv(csv, 'fintech-sample.csv')
    console.log(
      `[seed] generated example blog "/blog/${blog.slug}" ` +
        `(${blog.source.generatedBy === 'gemini' ? `AI copy via ${blog.source.model}` : 'template copy'})`,
    )
  } catch (err) {
    // Non-fatal: the app works without the seed (e.g. read-only serverless
    // filesystems); the user can always upload a CSV manually.
    console.error('[seed] example blog could not be generated:', err instanceof Error ? err.message : err)
  }
}
