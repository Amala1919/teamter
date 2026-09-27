export interface MockVoicevoxStats {
  audio_query: number
  accent_phrases: number
  synthesis: number
  speakers: number
  maxConcurrentSynthesis: number
}

export interface MockVoicevox {
  url: string
  stats: MockVoicevoxStats
  close: () => Promise<void>
}

export function startMockVoicevox(options?: { port?: number; delayMs?: number }): Promise<MockVoicevox>
export function textToAccentPhrases(text: string): unknown[]
export function engineFrames(query: unknown): number
export function makeWav(sampleCount: number, sampleRate: number): Buffer
