import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  CACHE_FOLDER_NAME,
  CACHE_MARKER,
  cacheTargetFor,
  copyCache,
  defaultCacheRoot,
  directorySize,
  finishCacheMove,
  markCacheRoot
} from '../src/main/core/cache-location'
import { createAppPaths } from '../src/main/core/paths'
import { createServices, type Services } from '../src/main/core/services'

function put(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

/** 合成した音声・プロキシ・一時ファイルの入ったキャッシュ。 */
async function filledCache(): Promise<{ base: string; root: string }> {
  const base = mkdtempSync(join(tmpdir(), 'zunda-cache-'))
  const root = defaultCacheRoot(join(base, 'userData'))
  await markCacheRoot(root)
  put(join(root, 'voice', 'a.wav'), 'voice-a')
  put(join(root, 'proxy', 'clip.mp4'), 'proxy-data-123')
  put(join(root, 'temp', 'work.tmp'), 'temporary')
  return { base, root }
}

describe('キャッシュの置き場所', () => {
  it('キャッシュの場所は設定で変えられ、無ければアプリのデータの中', () => {
    expect(createAppPaths('/data').cache.voice).toBe(join('/data', 'cache', 'voice'))
    expect(createAppPaths('/data', '/mnt/d/cache').cache.voice).toBe(join('/mnt/d/cache', 'voice'))
    expect(createAppPaths('/data', '/mnt/d/cache').settingsFile).toBe(join('/data', 'settings.json'))
  })

  it('選んだフォルダの中にキャッシュ用のフォルダを作って移す(一時ファイルは移さない)。進み具合を知らせる', async () => {
    const { base, root } = await filledCache()
    const chosen = join(base, 'D-drive')
    mkdirSync(chosen)
    const target = await cacheTargetFor(chosen)
    expect(target).toBe(join(chosen, CACHE_FOLDER_NAME))
    const progress: number[] = []
    const { copiedBytes } = await copyCache(root, target, (copied) => progress.push(copied))
    expect(readFileSync(join(target, 'voice', 'a.wav'), 'utf8')).toBe('voice-a')
    expect(readFileSync(join(target, 'proxy', 'clip.mp4'), 'utf8')).toBe('proxy-data-123')
    expect(existsSync(join(target, 'temp', 'work.tmp'))).toBe(false)
    expect(existsSync(join(target, CACHE_MARKER))).toBe(true)
    expect(copiedBytes).toBe('voice-a'.length + 'proxy-data-123'.length)
    expect(progress.at(-1)).toBe(copiedBytes)
    // 元はまだ消さない(次の起動で消す)
    expect(existsSync(join(root, 'voice', 'a.wav'))).toBe(true)
    // 移した先をもう一度選ぶと、その中に入れ子にせずそこを使う
    expect(await cacheTargetFor(target)).toBe(target)
    expect(await directorySize(target)).toBeGreaterThanOrEqual(copiedBytes)
  })

  it('今のキャッシュの中や、それを含むフォルダには移さない', async () => {
    const { base, root } = await filledCache()
    await expect(copyCache(root, join(root, 'voice', 'inner'))).rejects.toThrow('今のキャッシュの中')
    await expect(copyCache(root, base)).rejects.toThrow('含むフォルダ')
    await expect(copyCache(root, root)).rejects.toThrow('同じ場所')
  })

  it('次の起動で、移したあとに増えたものを写してから古い場所を消す。アプリの作った場所以外は消さない', async () => {
    const { base, root } = await filledCache()
    const target = join(base, 'D-drive', CACHE_FOLDER_NAME)
    await copyCache(root, target)
    // 移してから起動し直すまでに、古い場所で合成した音声
    put(join(root, 'voice', 'b.wav'), 'voice-b')
    expect(await finishCacheMove(root, target, root)).toBe('removed')
    expect(existsSync(root)).toBe(false)
    expect(readFileSync(join(target, 'voice', 'b.wav'), 'utf8')).toBe('voice-b')

    // 印の無いフォルダ(利用者のフォルダ)は消さない
    const userFolder = join(base, 'my-files')
    put(join(userFolder, 'important.txt'), 'keep')
    expect(await finishCacheMove(userFolder, target, join(base, 'elsewhere'))).toBe('kept')
    expect(existsSync(join(userFolder, 'important.txt'))).toBe(true)
    // 今の場所そのものも消さない
    expect(await finishCacheMove(target, target, root)).toBe('kept')
    expect(existsSync(target)).toBe(true)
  })
})

describe('起動したときのキャッシュの場所', () => {
  async function start(userData: string): Promise<Services> {
    return createServices({ userData, runtime: 'devhost', appVersion: 'test', picker: { pick: () => Promise.resolve(null) } })
  }

  it('設定の場所を使い、前の起動で移した古い場所を後片付けする', async () => {
    const base = mkdtempSync(join(tmpdir(), 'zunda-cache-start-'))
    const userData = join(base, 'userData')
    const oldRoot = defaultCacheRoot(userData)
    await markCacheRoot(oldRoot)
    put(join(oldRoot, 'voice', 'late.wav'), 'late')
    const target = join(base, 'D-drive', CACHE_FOLDER_NAME)
    put(join(userData, 'settings.json'), JSON.stringify({ storage: { cacheDir: target, cleanupCacheDir: oldRoot } }))

    const services = await start(userData)
    try {
      expect(services.paths.cache.root).toBe(target)
      expect(services.cache).toMatchObject({ root: target, defaultRoot: oldRoot, fallbackFrom: null })
      await vi.waitFor(() => expect(services.settings.get().storage.cleanupCacheDir).toBeNull())
      expect(existsSync(oldRoot)).toBe(false)
      expect(readFileSync(join(target, 'voice', 'late.wav'), 'utf8')).toBe('late')
    } finally {
      await services.dispose()
    }
  })

  it('設定の場所が使えなければ(ドライブを外したなど)既定の場所に戻し、それを知らせる。古い場所は消さない', async () => {
    const base = mkdtempSync(join(tmpdir(), 'zunda-cache-start-'))
    const userData = join(base, 'userData')
    // ファイルの下にはフォルダを作れない(使えない場所の代わり)
    put(join(base, 'not-a-folder'), 'x')
    const unusable = join(base, 'not-a-folder', 'cache')
    put(join(userData, 'settings.json'), JSON.stringify({ storage: { cacheDir: unusable, cleanupCacheDir: defaultCacheRoot(userData) } }))
    const services = await start(userData)
    try {
      expect(services.cache).toMatchObject({ root: defaultCacheRoot(userData), fallbackFrom: unusable })
      expect(existsSync(join(defaultCacheRoot(userData), CACHE_MARKER))).toBe(true)
    } finally {
      await services.dispose()
    }
  })
})
