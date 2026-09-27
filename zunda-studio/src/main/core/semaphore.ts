/** 同時に走らせる処理の数を制限する。音声エンジンは同時要求に弱いため、合成を順番待ちさせる。 */
export class Semaphore {
  private active = 0
  private readonly waiting: (() => void)[] = []

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolvePromise) => this.waiting.push(resolvePromise))
    }
    this.active++
    try {
      return await task()
    } finally {
      this.active--
      this.waiting.shift()?.()
    }
  }
}
