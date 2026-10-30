export const SITE = 'https://getspool.vercel.app'
export const REPO = 'https://github.com/pronzzz/spool'
export const RUN = `npx ${SITE}/spool-${__VERSION__}.tgz`

export type OS = 'mac' | 'windows' | 'linux'

export const TOOLS: Record<OS, { label: string; command: string }> = {
  mac: { label: 'macOS', command: 'brew install yt-dlp ffmpeg' },
  windows: { label: 'Windows', command: 'winget install yt-dlp.yt-dlp Gyan.FFmpeg' },
  linux: { label: 'Linux', command: 'pipx install yt-dlp && sudo apt install ffmpeg' },
}

export function detectOS(): OS {
  const p = `${navigator.platform} ${navigator.userAgent}`.toLowerCase()
  if (p.includes('win')) return 'windows'
  if (p.includes('linux') && !p.includes('android')) return 'linux'
  return 'mac'
}
