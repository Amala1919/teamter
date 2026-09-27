import type { ZundaApi } from '@shared/ipc/contract'

declare global {
  interface Window {
    zunda: ZundaApi
  }
}
