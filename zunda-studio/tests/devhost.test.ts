import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startDevHost, type DevHost } from '../src/devhost/server'
import { createEmptyProject } from '@shared/project/factory'
import type { IpcResult } from '@shared/ipc/contract'

import { FIXTURE_BIN, tempDir } from './helpers/env'

let host: DevHost
let root: string

beforeEach(async () => {
  root = await tempDir('zs-devhost-')
  const rendererDir = join(root, 'renderer')
  await mkdir(rendererDir)
  await writeFile(join(rendererDir, 'index.html'), '<!doctype html><title>zunda</title>')
  host = await startDevHost({ userData: join(root, 'userData'), rendererDir })
})

afterEach(async () => {
  await host.close()
})

async function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  const response = await fetch(`${host.url}/ipc/${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args })
  })
  return (await response.json()) as IpcResult<T>
}

describe('テスト用ホスト', () => {
  it('ハンドラ表を HTTP で呼べる', async () => {
    const info = await invoke<{ runtime: string }>('app:info')
    expect(info).toMatchObject({ ok: true, value: { runtime: 'devhost' } })
  })

  it('不明なチャネルと不正な引数を構造化されたエラーで返す', async () => {
    expect(await invoke('no:such')).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
    expect(await invoke('project:read', 42)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
  })

  it('設定を更新すると保存され、通知が届く', async () => {
    const received = new Promise<string>((resolvePromise) => {
      void fetch(`${host.url}/events`).then(async (response) => {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) return
          buffer += decoder.decode(value)
          if (buffer.includes('settings:changed')) {
            void reader.cancel()
            resolvePromise(buffer)
            return
          }
        }
      })
    })
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
    const updated = await invoke<{ ai: { roles: { editor: unknown } } }>('settings:update', {
      ai: { roles: { editor: { providerId: 'claude-code', model: 'opus' } } }
    })
    expect(updated.ok && updated.value.ai.roles.editor).toEqual({ providerId: 'claude-code', model: 'opus' })
    expect(await received).toContain('"model":"opus"')
  })

  it('積んだ応答でファイル選択を再現し、保存したプロジェクトを読み直せる', async () => {
    const path = join(root, 'ep1.zsproj')
    await fetch(`${host.url}/__test/pick`, { method: 'POST', body: JSON.stringify({ response: [path] }) })
    expect(await invoke('dialog:pick', { kind: 'saveProject' })).toEqual({ ok: true, value: [path] })
    // 何も積まれていなければキャンセル扱い
    expect(await invoke('dialog:pick', { kind: 'openProject' })).toEqual({ ok: true, value: null })

    const project = createEmptyProject({ title: 'テスト', renderSeed: 1 })
    expect(await invoke('project:write', path, project)).toMatchObject({ ok: true })
    const read = await invoke<{ meta: { title: string } }>('project:read', path)
    expect(read.ok && read.value.meta.title).toBe('テスト')

    const settings = await invoke<{ recentProjects: string[] }>('settings:get')
    expect(settings.ok && settings.value.recentProjects[0]).toBe(path)
  })

  it('許可されていないファイルは配信しない', async () => {
    const secret = join(root, 'secret.txt')
    await writeFile(secret, 'password')
    const response = await fetch(`${host.url}/media?path=${encodeURIComponent(secret)}`)
    expect(response.status).toBe(403)
  })

  it('素材として選ばれたファイルは Range 付きで配信する', async () => {
    const clip = join(root, 'clip.webm')
    await writeFile(clip, '0123456789')
    await fetch(`${host.url}/__test/pick`, { method: 'POST', body: JSON.stringify({ response: [clip] }) })
    await invoke('dialog:pick', { kind: 'video' })
    const response = await fetch(`${host.url}/media?path=${encodeURIComponent(clip)}`, {
      headers: { Range: 'bytes=3-5' }
    })
    expect(response.status).toBe(206)
    expect(await response.text()).toBe('345')
  })

  it('静的ファイルの配信でレンダラの外に出させない', async () => {
    const response = await fetch(`${host.url}/..%2F..%2Fetc%2Fpasswd`)
    const text = await response.text()
    expect(text).not.toContain('root:')
  })

  it('AIプロバイダの状態を返す', async () => {
    await invoke('settings:update', {
      ai: { providers: { 'claude-code': { executablePath: join(FIXTURE_BIN, 'claude') } } }
    })
    const result = await invoke<{ providerId: string; state: { kind: string } }[]>('ai:providers')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const claude = result.value.find((status) => status.providerId === 'claude-code')
    expect(claude?.state.kind).toBe('ready')
  })
})
