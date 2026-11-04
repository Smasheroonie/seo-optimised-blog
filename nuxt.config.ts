export default defineNuxtConfig({
  compatibilityDate: '2026-10-27',
  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // Server-only. Resolved at request time in server/utils/gemini.ts from
    // either these keys (overridable with NUXT_GEMINI_API_KEY /
    // NUXT_GEMINI_MODEL) or the GEMINI_API_KEY / GEMINI_MODEL env vars.
    // Never read process.env in this file for runtime values: that bakes
    // build-time values into the output.
    geminiApiKey: '',
    geminiModel: '',
    public: {
      // Used for canonical URLs, sitemap and robots.txt.
      siteUrl: 'http://localhost:3000',
    },
  },

  nitro: {
    // Generated blogs are stored as JSON documents through Nitro's storage
    // layer, decoupled from the presentation template.
    storage: {
      blogs: {
        driver: 'fs',
        base: './.data/blogs',
      },
    },
  },
})
