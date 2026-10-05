import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { FoundImage } from '@shared/ai/explainer'

import { AppError } from '../../core/errors'
import { fileExists } from '../../core/fs'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Wikimedia Commons の API。 */
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/** 画面に貼る画像の幅(これより大きい画像は縮めたものを落とす)。 */
const THUMB_WIDTH = 1280
/** 1枚の画像の大きさの上限。 */
const MAX_BYTES = 15 * 1024 * 1024
/** 貼れる画像の形式。 */
const MIME_EXTENSIONS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }

interface CommonsPage {
  title?: string
  index?: number
  imageinfo?: {
    url?: string
    thumburl?: string
    thumbwidth?: number
    thumbheight?: number
    width?: number
    height?: number
    mime?: string
    descriptionurl?: string
    extmetadata?: Record<string, { value?: string } | undefined>
  }[]
}

/** HTML(作者の欄などにリンクが入っている)を文字だけにする。 */
export function stripHtml(html: string): string {
  return html
    // 画面に出ない要素(Commons は「label QS:…」のような機械向けの文を隠して入れている)は中身ごと消す。
    .replace(/<(\w+)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 解説の参考画像を Wikimedia Commons から探して、ダウンロードする。
 * Commons の画像は自由なライセンスで、作者・ライセンス・説明ページが分かるので、出典を画面と概要欄に載せられる。
 * 落とした画像は userData/downloaded-images に置き(キャッシュの移動の影響を受けない場所)、配信を許可する。
 */
export class CommonsImageService {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly directory: string,
    private readonly allow: (path: string) => void,
    private readonly userAgent: string,
    options: { fetch?: FetchLike; apiBase?: string } = {}
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.apiBase = options.apiBase ?? COMMONS_API
  }

  private readonly apiBase: string

  /** 言葉を順に試し、最初に見つかった画像を落とす。どれでも見つからなければ null。 */
  async find(queries: readonly string[]): Promise<FoundImage | null> {
    for (const query of queries.map((value) => value.trim()).filter(Boolean)) {
      const pages = await this.search(query)
      for (const page of pages) {
        const found = await this.download(page).catch(() => null)
        if (found) return found
      }
    }
    return null
  }

  private async search(query: string): Promise<CommonsPage[]> {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: `${query} filetype:bitmap`,
      gsrnamespace: '6',
      gsrlimit: '8',
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|ObjectName',
      origin: '*'
    })
    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiBase}?${params.toString()}`, { headers: { 'User-Agent': this.userAgent, Accept: 'application/json' } })
    } catch (error) {
      throw new AppError('NETWORK', '画像を探せませんでした(インターネットにつながっているか確かめてください)', String(error))
    }
    if (!response.ok) throw new AppError('NETWORK', `画像を探せませんでした(${response.status})`)
    const body = (await response.json()) as { query?: { pages?: CommonsPage[] } }
    // 検索の順位(index)の順に並べる。
    return [...(body.query?.pages ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  }

  private async download(page: CommonsPage): Promise<FoundImage | null> {
    const info = page.imageinfo?.[0]
    if (!info) return null
    const extension = info.mime ? MIME_EXTENSIONS[info.mime] : undefined
    const url = info.thumburl ?? info.url
    if (!extension || !url) return null
    const meta = info.extmetadata ?? {}
    const license = stripHtml(meta['LicenseShortName']?.value ?? '')
    if (!license) return null
    const width = info.thumbwidth ?? info.width ?? 0
    const height = info.thumbheight ?? info.height ?? 0
    if (width <= 0 || height <= 0) return null

    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, `${createHash('sha256').update(url).digest('hex').slice(0, 24)}${extension}`)
    if (!(await fileExists(path))) {
      const response = await this.fetchImpl(url, { headers: { 'User-Agent': this.userAgent } })
      if (!response.ok) return null
      const data = Buffer.from(await response.arrayBuffer())
      if (data.length === 0 || data.length > MAX_BYTES) return null
      await writeFile(path, data)
    }
    this.allow(path)
    const fileTitle = (page.title ?? '').replace(/^File:/, '').replace(/\.[^.]+$/, '')
    return {
      path,
      width,
      height,
      title: stripHtml(meta['ObjectName']?.value ?? '') || fileTitle,
      author: stripHtml(meta['Artist']?.value ?? ''),
      license,
      licenseUrl: meta['LicenseUrl']?.value ? stripHtml(meta['LicenseUrl'].value) : null,
      pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title ?? '')}`,
      site: 'Wikimedia Commons'
    }
  }
}
