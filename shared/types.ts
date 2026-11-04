/**
 * Types shared between the server pipeline and the Nuxt presentation layer.
 *
 * The BlogData document is the contract between the three layers the brief
 * asks to keep separate: dataset -> pipeline (stats + AI copy) -> template.
 */
export interface BlogSeo {
  title: string
  description: string
  keywords: string[]
}

export interface BlogSection {
  heading: string
  paragraph: string
}

export interface BlogContent {
  intro: string
  sections: BlogSection[]
  conclusion: string
}

export interface NumericSummary {
  count: number
  withAmount: number
  total: number
  mean: number
  median: number
  max: number
}

export interface GroupSummary {
  label: string
  count: number
  total: number
}

export interface CategorySummary {
  column: string
  label: string
  groups: GroupSummary[]
}

export interface DatasetStats {
  rowCount: number
  currency: string
  nameColumn: string
  amountColumn: string | null
  numeric: NumericSummary | null
  top10: { rank: number; name: string; value: number }[]
  breakdowns: CategorySummary[]
}

export interface TableData {
  headers: string[]
  rows: string[][]
}

export interface BlogData {
  slug: string
  createdAt: string
  industry: string
  source: {
    filename: string
    rows: number
    generatedBy: 'gemini' | 'template'
  }
  seo: BlogSeo
  content: BlogContent
  stats: DatasetStats
  table: TableData
}

export interface BlogListItem {
  slug: string
  title: string
  industry: string
  createdAt: string
  rows: number
  generatedBy: 'gemini' | 'template'
}
