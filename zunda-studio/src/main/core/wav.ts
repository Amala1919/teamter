/**
 * WAV のヘッダから長さを読む。音声の長さは合成結果のファイルを正とし、計算値と食い違ったら気づけるようにする。
 */
export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  dataBytes: number
  durationMs: number
}

export function readWavInfo(buffer: Uint8Array): WavInfo {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const tag = (offset: number): string =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))

  if (buffer.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('WAV ファイルではありません')
  }

  let offset = 12
  let format: { sampleRate: number; channels: number; bitsPerSample: number } | null = null
  while (offset + 8 <= buffer.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      format = {
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true)
      }
    } else if (id === 'data') {
      if (!format) throw new Error('WAV の fmt チャンクが data より後にあります')
      const bytesPerSecond = format.sampleRate * format.channels * (format.bitsPerSample / 8)
      // ストリーミング出力では data のサイズが不定(0xFFFFFFFF)になることがあるので、実際の残りバイト数で上限をかける。
      const dataBytes = Math.min(size, buffer.byteLength - body)
      return { ...format, dataBytes, durationMs: Math.round((dataBytes / bytesPerSecond) * 1000) }
    }
    offset = body + size + (size % 2)
  }
  throw new Error('WAV に data チャンクがありません')
}
