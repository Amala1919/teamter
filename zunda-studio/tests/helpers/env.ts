import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { defaultSettings, mergeSettings, type AppSettings, type SettingsPatch } from '@shared/settings/schema'

export const FIXTURE_BIN = resolve('tests/fixtures/bin')

export async function tempDir(prefix = 'zs-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export function settingsWith(patch: SettingsPatch): AppSettings {
  return mergeSettings(defaultSettings(), patch)
}

/** 模擬CLIを指す設定。 */
export function fakeCliSettings(patch: SettingsPatch = {}): AppSettings {
  return mergeSettings(
    settingsWith({
      ai: {
        providers: {
          'claude-code': { executablePath: fixtureCommand('claude'), timeoutMs: 20_000 },
          opencode: { connection: 'cli', executablePath: fixtureCommand('opencode'), timeoutMs: 20_000 }
        }
      }
    }),
    patch
  )
}

export interface CliLogEntry {
  argv: string[]
  stdin: string
  cwd: string
  system?: string | null
  hasApiKey?: boolean
  config?: Record<string, unknown> | null
  disableClaudeCode?: string | null
}

export async function readCliLog(path: string): Promise<CliLogEntry[]> {
  const text = await readFile(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CliLogEntry)
}

/** 模擬コマンドの起動に使うパス。Windows は拡張子の無いスクリプトを起動できないので、同じ名前の .cmd を使う。 */
export function fixtureCommand(name: string): string {
  return join(FIXTURE_BIN, process.platform === 'win32' ? `${name}.cmd` : name)
}
