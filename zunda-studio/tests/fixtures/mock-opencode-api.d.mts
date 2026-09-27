export const GOOD_KEY: string

export interface MockOpenCodeApi {
  baseUrl: string
  calls: { path: string; model: string; body: Record<string, unknown> }[]
  close: () => Promise<void>
}

export function startMockOpenCodeApi(options?: { port?: number; basePath?: string }): Promise<MockOpenCodeApi>
