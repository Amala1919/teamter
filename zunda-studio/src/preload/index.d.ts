import type { ZundaBridge } from '@shared/ipc/contract'

declare global {
  interface Window {
    zunda?: ZundaBridge
  }
}
