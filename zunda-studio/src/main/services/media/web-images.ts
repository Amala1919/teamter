import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'

import type { ExplainerImageSource, FoundImage } from '@shared/ai/explainer'
import { isUntrustedImageUrl } from '@shared/ai/explainer'

import { fileExists } from '../../core/fs'
import { IMAGE_MIME_EXTENSIONS, MAX_IMAGE_BYTES, stripHtml } from './commons-images'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** ページの HTML の大きさの上限(代表の画像を探すため)。 */
const MAX_HTML_BYTES = 3 * 1024 * 1024
/** これより大きい画像は縮めて保存する(プレビューを重くしないため)。 */
const MAX_SIDE = 2560
const TIMEOUT_MS = 20_000

/** 手元の機械や家の中のネットワークを指す名前か(AI の出した URL で、外のサイト以外を読みに行かないため)。 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host === '::' || host === '::1') return true
  if (/^(fc|fd|fe8|fe9|fea|feb)[0-9a-f]*:/.test(host)) return true
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/** 先頭のバイトから画像の形式を見分ける(Content-Type が正しくないサイトもあるため)。 */
export function sniffImageMime(data: Uint8Array): string | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= 4 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif'
  if (data.length >= 12 && String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

interface PageInfo {
  /** ページの代表の画像(og:image など)。よい順。 */
  images: string[]
  title: string
  site: string
}

/** ページの HTML から、代表の画像・題・サイトの名前を読む。 */
export function readPageInfo(html: string, pageUrl: string): PageInfo {
  const meta = new Map<string, string>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map<string, string>()
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attributes.set(match[1]!.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
    }
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase()
    const content = attributes.get('content')
    if (key && content && !meta.has(key)) meta.set(key, stripHtml(content))
  }
  const images: string[] = []
  for (const key of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    const value = meta.get(key)
    if (!value) continue
    try {
      const absolute = new URL(value, pageUrl).toString()
      if (!images.includes(absolute)) images.push(absolute)
    } catch {
      // 読めない URL は使わない。
    }
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return {
    images,
    title: meta.get('og:title') ?? (titleTag ? stripHtml(titleTag[1]!) : ''),
    site: meta.get('og:site_name') ?? ''
  }
}

type Fetched = { kind: 'image'; data: Buffer; mime: string } | { kind: 'html'; html: string; url: string } | null

/**
 * 解説の参考画像を、AI がウェブで見つけたページ(一次ソース・信頼できるサイト)から落とす。
 * 画像の URL があればそれを、無い・読めないときはページの代表の画像(og:image)を使う。
 * 画像として読めるか(形式・大きさ)を確かめ、大きすぎる画像は縮めて userData/downloaded-images に置き、配信を許可する。
 * 転載・まとめのサイトと、手元の機械・家の中のネットワークの URL は読みに行かない。
 */
export class WebImageService {
  private readonly fetchImpl: FetchLike
  private readonly allowLocal: boolean

  constructor(
    private readonly directory: string,
    private readonly allow: (path: string) => void,
    private readonly userAgent: string,
    options: { fetch?: FetchLike; allowLocal?: boolean } = {}
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.allowLocal = options.allowLocal ?? false
  }

  /** 候補を順に試し、最初に使えた画像を返す。どれも使えなければ null。 */
  async find(sources: readonly ExplainerImageSource[]): Promise<FoundImage | null> {
    for (const source of sources) {
      const found = await this.fromSource(source).catch(() => null)
      if (found) return found
    }
    return null
  }

  private async fromSource(source: ExplainerImageSource): Promise<FoundImage | null> {
    if (!this.reachable(source.pageUrl)) return null
    let page: PageInfo | null = null
    const tried = new Set<string>()
    const attempt = async (url: string): Promise<{ data: Buffer; mime: string; url: string } | null> => {
      if (tried.has(url) || !this.reachable(url)) return null
      tried.add(url)
      const fetched = await this.get(url, source.pageUrl)
      if (fetched?.kind === 'image') return { data: fetched.data, mime: fetched.mime, url }
      // 画像の URL のつもりでページが返ってきたら、そのページの代表の画像を使う。
      if (fetched?.kind === 'html' && page === null) {
        page = readPageInfo(fetched.html, fetched.url)
        for (const image of page.images) {
          const nested = await attempt(image)
          if (nested) return nested
        }
      }
      return null
    }

    let image = source.imageUrl ? await attempt(source.imageUrl) : null
    if (!image && page === null) image = await attempt(source.pageUrl)
    if (!image) return null

    const saved = await this.save(image.data, image.mime, image.url)
    if (!saved) return null
    const info = page as PageInfo | null
    const host = new URL(source.pageUrl).hostname.replace(/^www\./, '')
    return {
      ...saved,
      title: source.title || info?.title || '',
      author: '',
      license: '',
      licenseUrl: null,
      pageUrl: source.pageUrl,
      site: source.site || info?.site || host,
      kind: source.kind
    }
  }

  private reachable(url: string): boolean {
    if (isUntrustedImageUrl(url)) return false
    return this.allowLocal || !isLocalHost(new URL(url).hostname)
  }

  /** URL を読む。画像なら中身を、ページなら HTML を返す。読めなければ null。 */
  private async get(url: string, referer: string): Promise<Fetched> {
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'image/*,text/html;q=0.8,*/*;q=0.5', Referer: referer },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
    } catch {
      return null
    }
    // 転送された先も、外のサイトでなければ使わない。
    if (!response.ok || (response.url && !this.reachable(response.url))) return null
    const length = Number(response.headers.get('content-length') ?? 0)
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    if (type === 'text/html' || type === 'application/xhtml+xml') {
      if (length > MAX_HTML_BYTES) return null
      const html = (await response.text()).slice(0, MAX_HTML_BYTES)
      return { kind: 'html', html, url: response.url || url }
    }
    if (length > MAX_IMAGE_BYTES) return null
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) return null
    const mime = sniffImageMime(data)
    return mime ? { kind: 'image', data, mime } : null
  }

  /** 画像として読めるか確かめて保存する(大きすぎれば縮める)。 */
  private async save(data: Buffer, mime: string, url: string): Promise<{ path: string; width: number; height: number } | null> {
    let image: Awaited<ReturnType<typeof loadImage>>
    try {
      image = await loadImage(data)
    } catch {
      return null
    }
    let { width, height } = image
    if (width <= 0 || height <= 0) return null
    let output = data
    let extension = IMAGE_MIME_EXTENSIONS[mime]!
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    if (scale < 1) {
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
      const canvas = createCanvas(width, height)
      canvas.getContext('2d').drawImage(image, 0, 0, width, height)
      // 写真は JPEG、透けるかもしれない形式は PNG で保存する。
      const asJpeg = mime === 'image/jpeg'
      output = asJpeg ? await canvas.encode('jpeg', 90) : await canvas.encode('png')
      extension = asJpeg ? '.jpg' : '.png'
    }
    await mkdir(this.directory, { recursive: true })
    const path = join(this.directory, `${createHash('sha256').update(url).digest('hex').slice(0, 24)}${extension}`)
    if (!(await fileExists(path))) await writeFile(path, output)
    this.allow(path)
    return { path, width, height }
  }
}
