import { copyFile, mkdir, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import { AppError } from './errors'
import { fileExists } from './fs'

/**
 * キャッシュ(プロキシの動画・合成した音声・波形など、消しても作り直せるもの)の置き場所。
 * 設定で別のドライブに移せる。移すときは今のキャッシュをコピーし、次の起動から新しい場所を使い、
 * 古い場所は確かめてから消す(アプリが作ったキャッシュの置き場所だけを消す)。
 */

/** アプリが作ったキャッシュの置き場所の印。この印がある場所だけを消す。 */
export const CACHE_MARKER = '.zunda-studio-cache'
/** 選んだフォルダの中に作る、キャッシュの置き場所の名前(利用者のファイルと混ぜないため)。 */
export const CACHE_FOLDER_NAME = 'zunda-studio-cache'
/** 移すときにコピーしないもの(一時ファイルと AI の作業場所は毎回作り直す。印は移す先で付け直す)。 */
const TRANSIENT = new Set(['temp', 'ai-work', '.zunda-studio-cache'])
/** コピーの後に残しておきたい空き(これより少なくなるなら移さない)。 */
const FREE_MARGIN_BYTES = 200 * 1024 * 1024

export function defaultCacheRoot(userData: string): string {
  return join(userData, 'cache')
}

/** キャッシュの置き場所に印を付ける(消してよい場所だと分かるように)。 */
export async function markCacheRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, CACHE_MARKER), 'zunda-studio のキャッシュです。消しても、必要になったときに作り直されます。\n')
}

/** 中のファイルの大きさの合計(バイト)。読めないものは数えない。 */
export async function directorySize(root: string): Promise<number> {
  let total = 0
  for (const file of await listFiles(root)) total += file.size
  return total
}

/** ドライブの空き(バイト)。分からなければ null。 */
export async function freeSpace(path: string): Promise<number | null> {
  // まだ無いフォルダなら、あるところまで遡って調べる。
  let current = resolve(path)
  for (;;) {
    try {
      const info = await statfs(current)
      return Number(info.bavail) * Number(info.bsize)
    } catch {
      const parent = resolve(current, '..')
      if (parent === current) return null
      current = parent
    }
  }
}

interface FileEntry {
  path: string
  size: number
}

async function listFiles(root: string, skipTopLevel: ReadonlySet<string> = new Set()): Promise<FileEntry[]> {
  const files: FileEntry[] = []
  const walk = async (directory: string, top: boolean): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (top && skipTopLevel.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path, false)
      else if (entry.isFile()) {
        try {
          files.push({ path, size: (await stat(path)).size })
        } catch {
          // 読めないファイルは飛ばす
        }
      }
    }
  }
  await walk(root, true)
  return files
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel))
}

/** 選んだフォルダから、キャッシュを置く場所を決める(選んだフォルダが既にキャッシュの置き場所ならそこ)。 */
export async function cacheTargetFor(chosen: string): Promise<string> {
  const resolved = resolve(chosen)
  return (await fileExists(join(resolved, CACHE_MARKER))) ? resolved : join(resolved, CACHE_FOLDER_NAME)
}

/**
 * 今のキャッシュを新しい場所へコピーする(元はまだ消さない。次の起動で新しい場所に切り替えてから消す)。
 * 一時ファイルは移さない。空きが足りなければ断る。
 */
export async function copyCache(
  from: string,
  to: string,
  onProgress: (copiedBytes: number, totalBytes: number) => void = () => {}
): Promise<{ copiedBytes: number }> {
  if (resolve(from) === resolve(to)) throw new AppError('INVALID_ARGUMENT', '今と同じ場所です')
  if (isInside(to, from)) throw new AppError('INVALID_ARGUMENT', '今のキャッシュの中には移せません。別のフォルダを選んでください')
  if (isInside(from, to)) throw new AppError('INVALID_ARGUMENT', '今のキャッシュを含むフォルダには移せません。別のフォルダを選んでください')
  const files = await listFiles(from, TRANSIENT)
  const total = files.reduce((sum, file) => sum + file.size, 0)
  const free = await freeSpace(to)
  if (free !== null && free < total + FREE_MARGIN_BYTES) {
    throw new AppError(
      'INVALID_ARGUMENT',
      `移す先の空きが足りません(必要 ${formatBytes(total + FREE_MARGIN_BYTES)}・空き ${formatBytes(free)})`
    )
  }
  await markCacheRoot(to)
  let copied = 0
  onProgress(0, total)
  for (const file of files) {
    const target = join(to, relative(from, file.path))
    await mkdir(resolve(target, '..'), { recursive: true })
    // 既に同じ大きさのものがあれば(前に途中まで移したなど)、コピーし直さない。
    const existing = await stat(target).catch(() => null)
    if (!existing || existing.size !== file.size) await copyFile(file.path, target)
    copied += file.size
    onProgress(copied, total)
  }
  return { copiedBytes: copied }
}

/**
 * 移したあとの起動で、古い場所の後片付けをする。移したあとに古い場所へ増えたファイルを写してから、古い場所を消す。
 * 消すのは、アプリが作ったキャッシュの置き場所(印があるか、既定の場所)だけ。
 */
export async function finishCacheMove(oldRoot: string, currentRoot: string, defaultRoot: string): Promise<'removed' | 'kept'> {
  if (resolve(oldRoot) === resolve(currentRoot) || isInside(currentRoot, oldRoot)) return 'kept'
  if (!(await fileExists(oldRoot))) return 'removed'
  const ours = resolve(oldRoot) === resolve(defaultRoot) || (await fileExists(join(oldRoot, CACHE_MARKER)))
  if (!ours) return 'kept'
  // 移したあと、再起動までに古い場所へ増えたもの(合成した音声など)を写す。
  for (const file of await listFiles(oldRoot, TRANSIENT)) {
    const target = join(currentRoot, relative(oldRoot, file.path))
    if (await fileExists(target)) continue
    await mkdir(resolve(target, '..'), { recursive: true })
    await copyFile(file.path, target).catch(() => undefined)
  }
  await rm(oldRoot, { recursive: true, force: true })
  return 'removed'
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}MB`
  return `${Math.ceil(bytes / 1024)}KB`
}
