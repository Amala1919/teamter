import { chmod } from 'node:fs/promises'

import { path7za } from '7zip-bin'

/**
 * 同梱の 7za(7-Zip のコマンド版)の場所。
 * 配布版では asar の中に置けない(実行できない)ので、asar の外に出したもの(app.asar.unpacked)を使う。
 */
export async function sevenZipPath(): Promise<string> {
  const path = path7za.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  if (process.platform !== 'win32') {
    // npm の展開で実行権限が落ちていることがある。
    await chmod(path, 0o755).catch(() => undefined)
  }
  return path
}
