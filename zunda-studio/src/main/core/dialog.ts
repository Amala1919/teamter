import type { PickRequest } from '@shared/ipc/contract'

/**
 * ファイル選択。Electron ではダイアログ、テスト用ホストでは事前に積んだ応答を返す。
 */
export interface FilePicker {
  pick: (request: PickRequest) => Promise<string[] | null>
}

export const PICK_FILTERS: Record<PickRequest['kind'], { name: string; extensions: string[] }[]> = {
  openProject: [{ name: 'zunda-studio プロジェクト', extensions: ['zsproj'] }],
  saveProject: [{ name: 'zunda-studio プロジェクト', extensions: ['zsproj'] }],
  video: [{ name: '動画', extensions: ['mp4', 'mkv', 'mov', 'webm', 'm4v', 'avi'] }],
  audio: [{ name: '音声', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac', 'opus'] }],
  image: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  psd: [{ name: 'PSD', extensions: ['psd'] }],
  exportVideo: [{ name: 'MP4 動画', extensions: ['mp4'] }],
  exportText: [{ name: 'テキスト', extensions: ['txt', 'srt'] }],
  executable: [{ name: 'すべてのファイル', extensions: ['*'] }],
  any: [{ name: 'すべてのファイル', extensions: ['*'] }]
}

/** テスト用ホストのファイル選択。テストが次の応答を積み、アプリがそれを消費する。 */
export class QueuedFilePicker implements FilePicker {
  private readonly queue: (string[] | null)[] = []

  enqueue(response: string[] | null): void {
    this.queue.push(response)
  }

  pick(): Promise<string[] | null> {
    // 何も積まれていなければキャンセル扱いにする。テストが意図せず先へ進まないように。
    return Promise.resolve(this.queue.length === 0 ? null : (this.queue.shift() ?? null))
  }
}
