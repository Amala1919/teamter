export function buildEngineArchive(options: { dir: string; target: string; version: string; volumeKb?: number }): {
  dir: string
  parts: string[]
}

export interface MockEngineRelease {
  release: { latestUrl: string; downloadBase: string }
  requests: string[]
  close: () => Promise<void>
}

export function startMockEngineRelease(options: {
  port?: number
  version: string
  archiveDir: string
  parts: string[]
  noApi?: boolean
}): Promise<MockEngineRelease>
