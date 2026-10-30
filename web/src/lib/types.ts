export type Format = 'mp3' | 'm4a' | 'mp4'

export interface Tool {
  ok: boolean
  version: string | null
  stale?: boolean
}

export interface Health {
  app: 'spool'
  version: string
  dir: string
  concurrency: number
  tools: { ytdlp: Tool; ffmpeg: Tool }
}

export interface SourceItem {
  id: string
  index: number
  title: string
  channel: string | null
  duration: number | null
  unavailable: boolean
}

export interface Source {
  kind: 'playlist' | 'video'
  id: string
  url: string
  title: string
  channel: string | null
  items: SourceItem[]
}

export type ItemState = 'queued' | 'downloading' | 'converting' | 'done' | 'skipped' | 'failed' | 'cancelled'

export interface JobItem {
  id: string
  index: number
  title: string
  state: ItemState
  progress: number
  speed: number | null
  eta: number | null
  file: string | null
  error: string | null
}

export interface JobSummary {
  id: string
  title: string
  kind: 'playlist' | 'video'
  format: Format
  quality: string
  dir: string
  state: 'running' | 'done' | 'cancelled'
  total: number
  counts: Record<'queued' | 'active' | 'done' | 'skipped' | 'failed' | 'cancelled', number>
  speed: number
  createdAt: number
  finishedAt: number | null
}

export interface Snapshot {
  job: JobSummary
  items: JobItem[]
}

export interface StartRequest {
  title: string
  kind: Source['kind']
  sourceUrl: string
  format: Format
  quality: string
  items: { id: string; index: number; title: string }[]
}

export interface Engine {
  demo: boolean
  health(): Promise<Health>
  inspect(url: string): Promise<Source>
  jobs(): Promise<JobSummary[]>
  start(req: StartRequest): Promise<Snapshot>
  snapshot(id: string): Promise<Snapshot>
  /** Calls back with a full snapshot first, then partial patches. */
  subscribe(id: string, on: (s: Snapshot, full: boolean) => void): () => void
  cancel(id: string): Promise<void>
  retry(id: string): Promise<void>
  reveal(id: string): Promise<void>
}
