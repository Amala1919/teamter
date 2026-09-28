import { spawn, type ChildProcess } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, extname, isAbsolute, join } from 'node:path'

export interface RunOptions {
  command: string
  args: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 標準入力に書き込む内容。プロンプトはコマンドライン長の制限を避けるためここで渡す。 */
  input?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** 出力が大きい処理で、全体をメモリに溜めずに逐次受け取りたいとき。 */
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

export interface RunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

const MAX_CAPTURE_BYTES = 32 * 1024 * 1024

/** Windows の .cmd / .bat はシェル経由でしか起動できない(Node の CVE-2024-27980 対策以降)。 */
export function needsShell(command: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' && ['.cmd', '.bat'].includes(extname(command).toLowerCase())
}

/**
 * cmd.exe に渡す引数のクォート。ダブルクォートで囲み、内部のダブルクォートは二重にする。
 * % による環境変数展開はクォートでも防げないため、% を含む引数は拒否する。
 */
export function quoteForCmd(argument: string): string {
  if (argument.includes('%')) {
    throw new Error(`cmd.exe 経由では % を含む引数を安全に渡せません: ${argument}`)
  }
  if (argument === '') return '""'
  if (/^[A-Za-z0-9._:/\\=@+,-]+$/.test(argument)) return argument
  return `"${argument.replace(/"/g, '""')}"`
}

export function spawnProcess(options: RunOptions): ChildProcess {
  const shell = needsShell(options.command)
  const command = shell ? quoteForCmd(options.command) : options.command
  const args = shell ? options.args.map(quoteForCmd) : [...options.args]
  return spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

export function runProcess(options: RunOptions): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcess
    try {
      child = spawnProcess(options)
    } catch (error) {
      rejectPromise(error)
      return
    }

    let stdout = ''
    let stderr = ''
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let timedOut = false
    let aborted = false
    let settled = false

    const capture = (current: string, chunk: string): string =>
      current.length > MAX_CAPTURE_BYTES ? current : current + chunk

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = capture(stdout, chunk)
      if (options.onStdoutLine) stdoutBuffer = emitLines(stdoutBuffer + chunk, options.onStdoutLine)
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = capture(stderr, chunk)
      if (options.onStderrLine) stderrBuffer = emitLines(stderrBuffer + chunk, options.onStderrLine)
    })

    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            terminate(child)
          }, options.timeoutMs)

    const onAbort = (): void => {
      aborted = true
      terminate(child)
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (options.onStdoutLine && stdoutBuffer !== '') options.onStdoutLine(stdoutBuffer)
      if (options.onStderrLine && stderrBuffer !== '') options.onStderrLine(stderrBuffer)
      resolvePromise({ exitCode, stdout, stderr, timedOut, aborted })
    }

    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      rejectPromise(error)
    })
    child.on('close', (code) => finish(code))

    if (options.signal?.aborted) onAbort()

    child.stdin?.on('error', () => {
      // 子プロセスが入力を読まずに終了した場合の EPIPE は、終了コードで判断するため無視する。
    })
    if (options.input !== undefined) child.stdin?.end(options.input, 'utf8')
    else child.stdin?.end()
  })
}

function emitLines(buffer: string, onLine: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/)
  const rest = lines.pop() ?? ''
  for (const line of lines) onLine(line)
  return rest
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const killer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, 3000)
  killer.unref()
}

/**
 * 実行ファイルを探す。設定で指定されていればそれを使い、無ければ PATH から探す。
 */
export async function resolveExecutable(
  name: string,
  configuredPath: string | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (configuredPath) {
    return (await isExecutable(configuredPath, platform)) ? configuredPath : null
  }
  return findOnPath(name, env, platform)
}

export async function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  if (isAbsolute(name)) return (await isExecutable(name, platform)) ? name : null
  const pathValue = env['PATH'] ?? env['Path'] ?? ''
  const directories = pathValue.split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
  // Windows では拡張子なしのファイル(npm が置く sh 用のシム等)は起動できないので候補にしない。
  const extensions =
    platform === 'win32'
      ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').map((ext) => ext.toLowerCase())
      : ['']
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, name + extension)
      if (await isExecutable(candidate, platform)) return candidate
    }
  }
  return null
}

async function isExecutable(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

export interface BufferRunResult {
  exitCode: number | null
  stdout: Buffer
  stderr: string
  timedOut: boolean
}

const MAX_BUFFER_BYTES = 32 * 1024 * 1024

/** 標準出力をバイト列のまま受け取る(画像などを出すコマンド用)。 */
export function runProcessBuffer(options: Omit<RunOptions, 'input' | 'onStdoutLine' | 'onStderrLine'>): Promise<BufferRunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ChildProcess
    try {
      child = spawnProcess(options)
    } catch (error) {
      rejectPromise(error)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let stderr = ''
    let timedOut = false
    child.stdin?.end()
    child.stdout?.on('data', (chunk: Buffer) => {
      if (size + chunk.length > MAX_BUFFER_BYTES) return
      chunks.push(chunk)
      size += chunk.length
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000)
    })
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, options.timeoutMs)
      : null
    const onAbort = (): void => {
      child.kill('SIGKILL')
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      rejectPromise(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolvePromise({ exitCode: code, stdout: Buffer.concat(chunks), stderr, timedOut })
    })
  })
}
