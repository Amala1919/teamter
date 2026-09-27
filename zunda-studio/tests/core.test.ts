import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MediaAccess, parseRange, serveMedia } from '@main/core/media-access'
import { findOnPath, needsShell, quoteForCmd } from '@main/core/process'
import { extractJson } from '@main/services/ai/json'
import { turnsToPrompt } from '@main/services/ai/provider'
import { resolveAssetPaths, withRelativeAssetPaths } from '@main/services/project/project-service'
import { isSafeModelId } from '@shared/ai/types'
import { createEmptyProject } from '@shared/project/factory'
import type { Project } from '@shared/project/types'
import { applySettingsPatch, defaultSettings, mergeSettings, parseSettings } from '@shared/settings/schema'

import { tempDir } from './helpers/env'

describe('Windows でのCLI起動', () => {
  it('.cmd と .bat だけシェル経由にする', () => {
    expect(needsShell('C:\\npm\\claude.cmd', 'win32')).toBe(true)
    expect(needsShell('C:\\tools\\opencode.BAT', 'win32')).toBe(true)
    expect(needsShell('C:\\tools\\claude.exe', 'win32')).toBe(false)
    expect(needsShell('/usr/bin/claude.cmd', 'linux')).toBe(false)
  })

  it('空白や記号を含む引数をクォートする', () => {
    expect(quoteForCmd('sonnet')).toBe('sonnet')
    expect(quoteForCmd('')).toBe('""')
    expect(quoteForCmd('C:\\Users\\山田 太郎\\file.txt')).toBe('"C:\\Users\\山田 太郎\\file.txt"')
    expect(quoteForCmd('a"b&c')).toBe('"a""b&c"')
    expect(quoteForCmd('mcp__*')).toBe('"mcp__*"')
  })

  it('% を含む引数は環境変数展開を防げないので拒否する', () => {
    expect(() => quoteForCmd('100%')).toThrow()
  })

  it('PATH から PATHEXT の拡張子付きで探し、拡張子なしのシムは無視する', async () => {
    const directory = await tempDir('zs-path-')
    await writeFile(join(directory, 'claude'), '#!/bin/sh')
    await writeFile(join(directory, 'claude.cmd'), '@echo off')
    const found = await findOnPath('claude', { PATH: directory, PATHEXT: '.EXE;.CMD' }, 'win32')
    expect(found).toBe(join(directory, 'claude.cmd'))
  })

  it('見つからなければ null', async () => {
    expect(await findOnPath('zs-does-not-exist', { PATH: '/nonexistent' }, 'linux')).toBeNull()
  })
})

describe('モデルID', () => {
  it('CLIに渡してよい文字だけを許す', () => {
    expect(isSafeModelId('claude-opus-5')).toBe(true)
    expect(isSafeModelId('opencode-go/qwen3.8-max')).toBe(true)
    expect(isSafeModelId('claude-sonnet-5[1m]')).toBe(true)
    expect(isSafeModelId('model; rm -rf')).toBe(false)
    expect(isSafeModelId('')).toBe(false)
    expect(isSafeModelId('$(whoami)')).toBe(false)
  })
})

describe('AI応答からのJSON抽出', () => {
  it('そのままのJSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('コードブロックで囲まれたJSON', () => {
    expect(extractJson('こちらです\n```json\n{"a":[1,2]}\n```\n以上')).toEqual({ a: [1, 2] })
  })
  it('前置き付きで文字列中に括弧を含むJSON', () => {
    expect(extractJson('結果: {"text":"「}」を含む","n":2} です')).toEqual({ text: '「}」を含む', n: 2 })
  })
  it('JSONが無ければ例外', () => {
    expect(() => extractJson('ごめんなさい')).toThrow()
  })
})

describe('会話のプロンプト化', () => {
  it('1発話ならそのまま', () => {
    expect(turnsToPrompt([{ role: 'user', content: 'やあ' }])).toBe('やあ')
  })
  it('複数なら履歴と今回の依頼を分ける', () => {
    const prompt = turnsToPrompt([
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
      { role: 'user', content: 'C' }
    ])
    expect(prompt).toMatch(/\[ユーザー\]\nA/)
    expect(prompt).toMatch(/\[あなた\]\nB/)
    expect(prompt.endsWith('C')).toBe(true)
  })
})

describe('メディア配信', () => {
  it('Range を解釈する', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 })
    expect(parseRange('bytes=200-300', 100)).toBe('invalid')
    expect(parseRange('items=0-1', 100)).toBe('invalid')
  })

  it('許可されたファイルとキャッシュ配下だけ配信する', async () => {
    const directory = await tempDir('zs-media-')
    const cache = join(directory, 'cache')
    await mkdir(cache)
    const allowed = join(directory, 'clip.mp4')
    const secret = join(directory, 'secret.txt')
    await writeFile(allowed, '0123456789')
    await writeFile(secret, 'password')
    await writeFile(join(cache, 'voice.wav'), 'RIFF')

    const access = new MediaAccess()
    access.allowFile(allowed)
    access.allowRoot(cache)

    expect(access.isAllowed(allowed)).toBe(true)
    expect(access.isAllowed(join(cache, 'voice.wav'))).toBe(true)
    expect(access.isAllowed(secret)).toBe(false)
    // ../ で許可ディレクトリの外に出る要求を拒否する
    expect(access.isAllowed(join(cache, '..', 'secret.txt'))).toBe(false)

    const partial = await serveMedia(access, allowed, 'bytes=2-4')
    expect(partial.status).toBe(206)
    expect(partial.headers['Content-Range']).toBe('bytes 2-4/10')
    expect(partial.headers['Content-Type']).toBe('video/mp4')
    partial.body?.destroy()

    await expect(serveMedia(access, secret, null)).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
  })
})

describe('設定', () => {
  it('空の入力から既定値を作る', () => {
    const settings = parseSettings({})
    expect(settings.ai.roles).toEqual({ conversation: null, editor: null })
    expect(settings.ai.providers.opencode.providerFilter).toBe('opencode-go')
    expect(settings.voice.engines[0]?.url).toBe('http://127.0.0.1:50021')
  })

  it('壊れた項目だけ既定値に戻し、他の設定は残す', () => {
    const settings = parseSettings({
      ai: { roles: { conversation: { providerId: 'claude-code', model: 'sonnet' } } },
      voice: { engines: 'これは壊れている' }
    })
    expect(settings.ai.roles.conversation).toEqual({ providerId: 'claude-code', model: 'sonnet' })
    expect(settings.voice.engines).toHaveLength(1)
  })

  it('部分的な更新を統合し、配列は置き換える', () => {
    const base = mergeSettings(defaultSettings(), { recentProjects: ['a', 'b'] })
    const merged = mergeSettings(base, {
      ai: { roles: { editor: { providerId: 'opencode', model: 'opencode-go/kimi-k3' } } },
      recentProjects: ['c']
    })
    expect(merged.ai.roles.editor).toEqual({ providerId: 'opencode', model: 'opencode-go/kimi-k3' })
    expect(merged.ai.roles.conversation).toBeNull()
    expect(merged.recentProjects).toEqual(['c'])
  })

  it('不正な更新は拒否し、既定値ではなく更新前の値を保つ', () => {
    const base = mergeSettings(defaultSettings(), {
      ai: { roles: { conversation: { providerId: 'claude-code', model: 'sonnet' } } }
    })
    const { settings, rejected } = applySettingsPatch(base, {
      ai: { roles: { editor: { providerId: 'claude-code', model: '' } } }
    })
    expect(rejected).toEqual(['ai'])
    expect(settings.ai.roles.conversation).toEqual({ providerId: 'claude-code', model: 'sonnet' })
  })

  it('未対応のプロバイダ指定は受け付けない', () => {
    const settings = parseSettings({ ai: { roles: { editor: { providerId: 'unknown', model: 'x' } } } })
    expect(settings.ai.roles.editor).toBeNull()
  })
})

describe('素材パス', () => {
  function projectWithAsset(absolute: string): Project {
    const project = createEmptyProject({ renderSeed: 1 })
    project.assets['ast_1'] = {
      type: 'image',
      path: { absolute, relative: null },
      width: 1,
      height: 1,
      license: { source: 'test', creditRequired: false }
    }
    return project
  }

  it('保存時にプロジェクトからの相対パスを記録する', () => {
    const project = withRelativeAssetPaths(projectWithAsset('/videos/game/a.png'), '/videos/project/ep1.zsproj')
    expect(project.assets['ast_1']?.path.relative).toBe('../game/a.png')
  })

  it('移動先で相対パスの先にファイルがあればそちらを使う', async () => {
    const root = await tempDir('zs-move-')
    await mkdir(join(root, 'moved', 'assets'), { recursive: true })
    await writeFile(join(root, 'moved', 'assets', 'a.png'), 'png')
    const project = projectWithAsset('/old/location/a.png')
    project.assets['ast_1']!.path.relative = 'assets/a.png'
    const resolved = await resolveAssetPaths(project, join(root, 'moved', 'ep1.zsproj'))
    expect(resolved.assets['ast_1']?.path.absolute).toBe(join(root, 'moved', 'assets', 'a.png'))
  })

  it('相対パスの先に無ければ元の絶対パスを残す', async () => {
    const project = projectWithAsset('/old/location/a.png')
    project.assets['ast_1']!.path.relative = 'assets/a.png'
    const resolved = await resolveAssetPaths(project, '/nowhere/ep1.zsproj')
    expect(resolved.assets['ast_1']?.path.absolute).toBe('/old/location/a.png')
  })
})
