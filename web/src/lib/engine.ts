import type { Engine, Health, JobSummary, Snapshot, Source, StartRequest } from './types'

export const DEFAULT_PORT = 7317

const isLocalPage = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)

/** Port the hosted site should look for the engine on (?port=1234 overrides). */
export function enginePort(): number {
  const fromQuery = Number(new URLSearchParams(location.search).get('port'))
  return Number.isInteger(fromQuery) && fromQuery > 0 ? fromQuery : DEFAULT_PORT
}

/** On localhost the page is served by the engine (or the dev proxy) itself. */
export const servedByEngine = isLocalPage

export function engineBase(): string {
  return isLocalPage ? '' : `http://localhost:${enginePort()}`
}

export class EngineError extends Error {
  constructor(message: string, readonly offline = false) {
    super(message)
  }
}

export function realEngine(base = engineBase()): Engine {
  async function call<T>(path: string, init?: RequestInit & { timeout?: number }): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${base}/api${path}`, {
        ...init,
        headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
        signal: AbortSignal.timeout(init?.timeout ?? 150_000),
      })
    } catch {
      throw new EngineError('Spool’s engine isn’t answering on this computer.', true)
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new EngineError(data.error || `The engine replied ${res.status}.`)
    return data as T
  }

  const post = <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

  return {
    demo: false,
    health: () => call<Health>('/health', { timeout: 2500 }),
    inspect: (url) => post<Source>('/inspect', { url }),
    jobs: () => call<{ jobs: JobSummary[] }>('/jobs').then((r) => r.jobs),
    start: (req: StartRequest) => post<Snapshot>('/jobs', req),
    snapshot: (id) => call<Snapshot>(`/jobs/${id}`),
    subscribe(id, on) {
      const es = new EventSource(`${base}/api/jobs/${id}/events`)
      es.addEventListener('snapshot', (e) => on(JSON.parse((e as MessageEvent).data), true))
      es.addEventListener('patch', (e) => on(JSON.parse((e as MessageEvent).data), false))
      return () => es.close()
    },
    cancel: (id) => post<void>(`/jobs/${id}/cancel`),
    retry: (id) => post<void>(`/jobs/${id}/retry`),
    reveal: (id) => post<void>(`/jobs/${id}/reveal`),
  }
}
