import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

import { AppError } from './errors'

/**
 * レンダラに配信してよいファイルの許可リスト。
 * レンダラが任意のパスを要求できると、画面側の不具合がそのまま任意ファイルの読み出しになるため、
 * main 側で「プロジェクトに登録された素材」と「アプリのキャッシュ」に限定する。
 */
export class MediaAccess {
  private readonly files = new Set<string>()
  private readonly roots = new Set<string>()

  allowFile(path: string): void {
    this.files.add(resolve(path))
  }

  allowFiles(paths: Iterable<string>): void {
    for (const path of paths) this.allowFile(path)
  }

  allowRoot(directory: string): void {
    this.roots.add(resolve(directory) + sep)
  }

  isAllowed(path: string): boolean {
    const normalized = resolve(path)
    if (this.files.has(normalized)) return true
    for (const root of this.roots) {
      if (normalized.startsWith(root)) return true
    }
    return false
  }
}

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json'
}

export function mimeTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

export interface MediaResponse {
  status: 200 | 206 | 416
  headers: Record<string, string>
  body: Readable | null
}

/**
 * Range 要求に対応してファイルを返す。<video> のシークは Range 要求で行われるため必須。
 */
export async function serveMedia(
  access: MediaAccess,
  path: string,
  rangeHeader: string | null
): Promise<MediaResponse> {
  if (!access.isAllowed(path)) {
    throw new AppError('ACCESS_DENIED', `配信が許可されていないファイルです: ${path}`)
  }
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error('not a file')
    size = info.size
  } catch {
    throw new AppError('NOT_FOUND', `ファイルが見つかりません: ${path}`)
  }

  const baseHeaders = {
    'Content-Type': mimeTypeFor(path),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache'
  }

  const range = parseRange(rangeHeader, size)
  if (range === 'invalid') {
    return { status: 416, headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` }, body: null }
  }
  if (range === null) {
    return {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(size) },
      body: createReadStream(path)
    }
  }
  return {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': String(range.end - range.start + 1),
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`
    },
    body: createReadStream(path, { start: range.start, end: range.end })
  }
}

export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return 'invalid'
  const [, startText = '', endText = ''] = match
  if (startText === '' && endText === '') return 'invalid'

  let start: number
  let end: number
  if (startText === '') {
    // bytes=-500 は末尾500バイト
    const suffix = Number(endText)
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1)
  }
  if (start > end || start >= size) return 'invalid'
  return { start, end }
}
