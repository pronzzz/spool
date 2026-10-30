import { useState } from 'react'
import type { ComponentChildren } from 'preact'
import Console from './components/Console'
import Deck from './components/Deck'
import { BlurText, CopyCommand, Logo, Reveal, ThemeToggle } from './components/bits'
import { REPO, RUN, TOOLS, detectOS, type OS } from './lib/install'
import { useSpool } from './lib/useSpool'

export default function App() {
  const spool = useSpool()
  const { job, progress, source } = spool

  return (
    <>
      <a className="skip" href="#app">
        Skip to Spool
      </a>
      <header className="top">
        <a className="brand" href="#top" aria-label="Spool home">
          <Logo />
          <span>spool</span>
        </a>
        <nav className="nav" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#install">Install</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GitHub<span aria-hidden="true">&nbsp;↗</span>
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow fade-up" style={{ animationDelay: '60ms' }}>
              A calm front end for yt-dlp
            </p>
            <BlurText
              className="display"
              text={['Wind', 'a', 'whole', <em key="p">playlist</em>, 'onto', 'your', 'disk.']}
            />
            <p className="lede fade-up" style={{ animationDelay: '640ms' }}>
              Paste a YouTube link, pick a format, press Spool. Every video lands in a numbered folder on your computer —
              tagged, with cover art, and ready to sync again later.
            </p>
          </div>
          <div className="hero-deck fade-up" style={{ animationDelay: '300ms' }}>
            <Deck
              progress={progress.share}
              active={job?.state === 'running'}
              done={progress.finished}
              total={progress.total}
              label={job?.title ?? source?.title ?? 'side a — empty'}
            />
          </div>
        </section>

        <Console spool={spool} />

        <Reveal as="section" id="how" className="section">
          <SectionHead index="01" title="How it works" />
          <ol className="steps">
            <Step n="1" title="Start the engine">
              One command. It checks for yt-dlp and ffmpeg, then opens Spool in your browser.
            </Step>
            <Step n="2" title="Paste a link">
              A playlist, a single video, a YouTube Music album, or a channel’s Videos tab.
            </Step>
            <Step n="3" title="Pick and spool">
              MP3, M4A or MP4. Untick what you don’t want — shift-click for a range — and press Spool.
            </Step>
            <Step n="4" title="Open the folder">
              <code>~/Downloads/Spool/Playlist/001 Title.mp3</code>, numbered in playlist order.
            </Step>
          </ol>
        </Reveal>

        <Reveal as="section" className="section">
          <SectionHead index="02" title="Why it runs on your machine" />
          <div className="grid">
            <Principle title="Your connection, not a server’s">
              YouTube blocks most cloud servers. Running locally means downloads keep working, and nothing passes through anyone
              else’s computer.
            </Principle>
            <Principle title="Straight to disk">
              No zips, no waiting for a server to hand files back. Each file lands the moment it’s finished.
            </Principle>
            <Principle title="Spool it again later">
              Every folder remembers what it already has. Run the same playlist next month and only the new videos download.
            </Principle>
            <Principle title="Tagged and tidy">
              Title, artist and cover art are written into every file. Names follow the playlist order.
            </Principle>
            <Principle title="Patient with failures">
              Three downloads at a time. Anything that fails tries twice more on its own, then waits for one click to retry.
            </Principle>
            <Principle title="Nothing to sign up for">
              No accounts, no tracking, no ads. Open source, MIT licensed, and the engine has zero dependencies.
            </Principle>
          </div>
        </Reveal>

        <Install />

        <Reveal as="section" className="section">
          <SectionHead index="04" title="Questions" />
          <div className="faq">
            <Faq q="Can I download anything with it?">
              Spool is a front end for yt-dlp, and YouTube’s terms still apply. Only keep videos you have the right to: your own
              uploads, Creative Commons or public-domain work, or where the creator allows it.
            </Faq>
            <Faq q="Why isn’t this just a website?">
              A website would need a server to do the downloading. YouTube blocks most of them, and every file would take a
              detour through it. The engine is a few hundred lines that run next to your browser instead.
            </Faq>
            <Faq q="Downloads suddenly started failing.">
              YouTube changes often and yt-dlp keeps up. Update it (<code>brew upgrade yt-dlp</code>, <code>pipx upgrade yt-dlp</code>{' '}
              or <code>winget upgrade yt-dlp</code>) and restart the engine. Spool warns you when your copy is getting old.
            </Faq>
            <Faq q="It says the engine isn’t connected, but it’s running.">
              Safari doesn’t let websites talk to programs on your own computer. Use the window the engine opens (
              <code>localhost:7317</code>), or Chrome, Edge, Arc or Firefox. Chrome may ask to allow access to your local network
              once — that’s the engine.
            </Faq>
            <Faq q="What happened to PlaylistHydra?">
              This is it, rebuilt. PlaylistHydra downloaded on a hosted server and zipped the files back to you; Spool does the work
              on your own machine and drops the hosting bill.
            </Faq>
          </div>
        </Reveal>
      </main>

      <footer className="foot">
        <div className="foot-row">
          <span className="brand">
            <Logo size={18} />
            <span>spool</span>
          </span>
          <span className="faint">v{__VERSION__} · MIT</span>
        </div>
        <div className="foot-row faint">
          <span>
            Built by{' '}
            <a href="https://github.com/pronzzz" target="_blank" rel="noreferrer">
              Pranav Dwivedi
            </a>{' '}
            on top of{' '}
            <a href="https://github.com/yt-dlp/yt-dlp" target="_blank" rel="noreferrer">
              yt-dlp
            </a>
            .
          </span>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source ↗
          </a>
        </div>
      </footer>
    </>
  )
}

function SectionHead({ index, title }: { index: string; title: string }) {
  return (
    <div className="section-head">
      <span className="mono faint">{index}</span>
      <h2>{title}</h2>
    </div>
  )
}

function Step({ n, title, children }: { n: string; title: string; children: ComponentChildren }) {
  return (
    <li className="step">
      <span className="step-n mono">{n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </li>
  )
}

function Principle({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div className="principle">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: ComponentChildren }) {
  return (
    <details className="faq-item">
      <summary>
        {q}
        <span className="faq-mark" aria-hidden="true" />
      </summary>
      <p>{children}</p>
    </details>
  )
}

function Install() {
  const [os, setOs] = useState<OS>(detectOS)
  return (
    <Reveal as="section" id="install" className="section">
      <SectionHead index="03" title="Install" />
      <div className="install">
        <div className="tabs" role="tablist" aria-label="Operating system">
          {(Object.keys(TOOLS) as OS[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={os === k} className={`tab${os === k ? ' is-on' : ''}`} onClick={() => setOs(k)}>
              {TOOLS[k].label}
            </button>
          ))}
        </div>
        <CopyCommand label="1 · tools" command={TOOLS[os].command} />
        <CopyCommand label="2 · engine" command={RUN} />
        <p className="install-note">
          Needs <a href="https://nodejs.org" target="_blank" rel="noreferrer">Node 20 or newer</a>. Leave the terminal open while
          you use Spool; <kbd>ctrl</kbd> <kbd>c</kbd> stops it.
        </p>
        <dl className="flags">
          <div>
            <dt className="mono">--dir ~/Music/YouTube</dt>
            <dd>Save somewhere other than ~/Downloads/Spool</dd>
          </div>
          <div>
            <dt className="mono">--concurrency 5</dt>
            <dd>Downloads at once, 1 to 8 (default 3)</dd>
          </div>
          <div>
            <dt className="mono">--port 7400</dt>
            <dd>
              Use another port, then open this site with <span className="mono">?port=7400</span>
            </dd>
          </div>
          <div>
            <dt className="mono">doctor</dt>
            <dd>Check that yt-dlp and ffmpeg are found</dd>
          </div>
        </dl>
      </div>
    </Reveal>
  )
}
