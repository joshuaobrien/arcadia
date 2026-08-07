import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Album,
  ArrowDownToLine,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleEllipsis,
  Disc3,
  Gauge,
  Heart,
  Home,
  Library,
  ListMusic,
  Maximize2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Waves,
  X,
} from 'lucide-react'
import './styles.css'

const releases = [
  {
    title: 'Imaginal Disk',
    artist: 'Magdalena Bay',
    year: '2024',
    color: 'coral',
    tag: 'Synthpop',
    status: 'In library',
  },
  {
    title: 'Diamond Jubilee',
    artist: 'Cindy Lee',
    year: '2024',
    color: 'blue',
    tag: 'Art pop',
    status: 'In library',
  },
  {
    title: 'Songs',
    artist: 'Adrianne Lenker',
    year: '2020',
    color: 'cream',
    tag: 'Folk',
    status: 'In library',
  },
  {
    title: 'Endlessness',
    artist: 'Nala Sinephro',
    year: '2024',
    color: 'violet',
    tag: 'Ambient jazz',
    status: 'Wanted',
  },
  {
    title: 'Two Star & The Dream Police',
    artist: 'Mk.gee',
    year: '2024',
    color: 'green',
    tag: 'Alternative',
    status: 'In library',
  },
]

const jobs = [
  { title: 'Bright Future', artist: 'Adrianne Lenker', source: 'Soulseek', progress: 72, meta: 'FLAC · 284 MB', state: 'Downloading' },
  { title: 'No Hands', artist: 'Joey Valence & Brae', source: 'Soulseek', progress: 100, meta: 'MP3 V0 · 96 MB', state: 'Matching' },
  { title: 'Lives Outgrown', artist: 'Beth Gibbons', source: 'Torrent', progress: 38, meta: 'FLAC · 318 MB', state: 'Downloading' },
]

const syncItems = [
  { title: 'Imaginal Disk', artist: 'Magdalena Bay', detail: '15 tracks · FLAC · direct copy', size: '624 MB', action: 'ADD' },
  { title: 'Diamond Jubilee', artist: 'Cindy Lee', detail: '32 tracks · artwork update', size: '1.1 MB', action: 'UPDATE' },
  { title: 'Songs', artist: 'Adrianne Lenker', detail: '11 tracks · FLAC · direct copy', size: '388 MB', action: 'ADD' },
]

const tracks = [
  ['1', 'She Looked Like Me!', '3:13'],
  ['2', 'Killing Time', '3:54'],
  ['3', 'True Blue Interlude', '1:49'],
  ['4', 'Image', '3:33'],
  ['5', 'Death & Romance', '5:14'],
]

function Cover({ release, size = 'normal' }) {
  return (
    <div className={`cover cover-${release.color} cover-${size}`} aria-label={`${release.title} cover`}>
      <div className="cover-grain" />
      <span>{release.title.split(' ')[0]}</span>
      <small>{release.artist}</small>
    </div>
  )
}

function Sidebar({ view, setView }) {
  const items = [
    ['home', Home, 'Device'],
    ['library', Library, 'Library'],
    ['discover', Sparkles, 'Acquire'],
    ['wanted', ListMusic, 'Sync list'],
    ['activity', Gauge, 'Transfers'],
  ]
  return (
    <header className="sidebar">
      <button className="brand" onClick={() => setView('home')}>
        <span className="brand-mark"><Disc3 size={22} /></span>
        <span>NEEDLE<small>music system</small></span>
      </button>
      <nav>
        {items.map(([id, Icon, label]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
            <Icon size={19} strokeWidth={1.8} /> {label}
            {id === 'wanted' && <b>12</b>}
            {id === 'activity' && <i>3</i>}
          </button>
        ))}
      </nav>
      <div className="system-status">
        <div><span className="pulse" /> ONLINE</div>
        <small>5/5 adapters</small>
      </div>
    </header>
  )
}

function Topbar({ query, setQuery }) {
  return (
    <header className="topbar">
      <div className="searchbox">
        <Search size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search library and sources" />
        <kbd>⌘ K</kbd>
      </div>
      <div className="top-status"><span>DEVICE</span><b>89.3 GB</b></div>
      <div className="top-status"><span>SYNC</span><b>46</b></div>
      <button className="icon-btn"><Settings size={19} /></button>
    </header>
  )
}

function ReleaseCard({ release, setSelected }) {
  const [liked, setLiked] = useState(false)
  return (
    <article className="release-card" onClick={() => setSelected(release)}>
      <div className="cover-wrap">
        <Cover release={release} />
        <button className="round-play" aria-label="Play album"><Play size={18} fill="currentColor" /></button>
        <button className={`heart ${liked ? 'liked' : ''}`} onClick={(e) => { e.stopPropagation(); setLiked(!liked) }}>
          <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
        </button>
      </div>
      <h3>{release.title}</h3>
      <p>{release.artist}</p>
      <div className="card-meta"><span>{release.year}</span><span>•</span><span>{release.tag}</span></div>
    </article>
  )
}

function HomeView({ setSelected, setView, filteredReleases }) {
  return (
    <>
      <section className="welcome-row">
        <div><p className="eyebrow">NW-A55 / Mounted</p><h1>Walkman</h1><p>USB mass storage · microSD detected · Last sync 2 days ago</p></div>
        <div className="clock-block"><span>MICROSD STORAGE</span><b>89.3 GB</b><small>of 128 GB</small></div>
      </section>

      <section className="mode-select">
        <button className="mode-tile mode-green"><span>01</span><div className="object-icon usb-object"><i/><i/><i/></div><div className="mode-copy"><b>SYNC NOW</b><small>46 tracks / 3 updates / 1.1 GB</small></div><ChevronRight/></button>
        <button className="mode-tile mode-blue" onClick={() => setView('library')}><span>02</span><div className="object-icon cd-stack"><i/><i/><i/></div><div className="mode-copy"><b>LIBRARY</b><small>Build device selection</small></div><ChevronRight/></button>
        <button className="mode-tile mode-red" onClick={() => setView('discover')}><span>03</span><div className="object-icon drive-object"><i/><i/><i/></div><div className="mode-copy"><b>ACQUIRE</b><small>Search connected sources</small></div><ChevronRight/></button>
        <button className="mode-tile mode-yellow" onClick={() => setView('activity')}><span>04</span><div className="object-icon sd-object"><i/><i/><i/><i/></div><div className="mode-copy"><b>TRANSFERS</b><small>3 acquisition jobs active</small></div><ChevronRight/></button>
      </section>

      <section className="console-workbench">
        <div className="device-panel">
          <div className="panel-label"><span>DEVICE / SONY NW-A55</span><i>MOUNTED</i></div>
          <div className="device-body">
            <div className="walkman-stage" aria-label="Spinning 3D Sony Walkman NW-A55 render"><div className="walkman-shadow"/><div className="walkman-model"><div className="walkman-face walkman-front"><span className="sony-logo">SONY</span><div className="walkman-screen"><div className="screen-bar"><span>10:42</span><span>▮▮▮</span></div><div className="screen-album"><i>IMAGINAL<br/>DISK</i></div><strong>Image</strong><small>Magdalena Bay</small><div className="screen-progress"><i/></div><div className="screen-controls">◀　▶　▶|</div></div><span className="walkman-logo">WALKMAN</span></div><div className="walkman-face walkman-back"><b>WALKMAN</b><span>NW-A55</span><small>SONY CORPORATION<br/>MADE IN MALAYSIA</small></div><div className="walkman-face walkman-left"/><div className="walkman-face walkman-right"><i/><i/><i/><i/><i/></div><div className="walkman-face walkman-top"><i/></div><div className="walkman-face walkman-bottom"><i/><i/></div></div></div>
            <div className="device-copy"><small>CONTENT ON DEVICE</small><h2>7,842 tracks</h2><p>612 albums · 1,904 artists</p><dl><div><dt>Audio</dt><dd>FLAC + MP3</dd></div><div><dt>Target</dt><dd>128 GB microSD</dd></div><div><dt>Free</dt><dd>38.7 GB</dd></div></dl><div className="device-actions"><button className="primary"><ArrowDownToLine size={16}/> Sync 46 tracks</button><button className="outline-btn">Eject</button></div></div>
          </div>
        </div>
        <div className="activity-panel">
          <div className="section-heading compact"><div><p className="eyebrow">Pending changes</p><h2>Next sync</h2></div><button>Open sync list <ChevronRight size={17} /></button></div>
          <div className="sync-summary"><span><b>46</b> tracks</span><span><b>1.1</b> GB</span><span><b>~6</b> min</span></div>
          {syncItems.map((item) => <div className="sync-row" key={item.title}><span className={`sync-action ${item.action.toLowerCase()}`}>{item.action}</span><div><strong>{item.title}</strong><small>{item.artist} · {item.detail}</small></div><b>{item.size}</b></div>)}
        </div>
      </section>

      <section className="import-log">
        <div className="section-heading"><div><p className="eyebrow">Device history</p><h2>Recently synced</h2></div><button onClick={() => setView('library')}>Manage device music <ChevronRight size={17}/></button></div>
        <div className="release-grid compact-releases">{filteredReleases.slice(0,4).map((r) => <ReleaseCard key={r.title} release={r} setSelected={setSelected}/>)}</div>
      </section>
    </>
  )
}

function Job({ job }) {
  return (
    <div className="job">
      <div className="job-thumb"><ArrowDownToLine size={20}/></div>
      <div className="job-main"><div><strong>{job.title}</strong><span>{job.artist}</span></div><div className="progress"><i style={{width: `${job.progress}%`}} /></div><small>{job.source} · {job.meta}</small></div>
      <div className={`job-state ${job.state.toLowerCase()}`}><span />{job.state}</div>
      <button className="icon-btn"><CircleEllipsis size={19}/></button>
    </div>
  )
}

function ActivityView() {
  return (
    <section className="page-view">
      <div className="page-title"><div><p className="eyebrow">Unified queue</p><h1>Activity</h1><p>Acquisition, matching, and import status</p></div><button className="outline-btn"><SlidersHorizontal size={17}/> Filters</button></div>
      <div className="stats-row"><div><span>Active now</span><b>3</b><small>2 downloading, 1 matching</small></div><div><span>Completed today</span><b>7</b><small>2.8 GB added</small></div><div><span>Needs attention</span><b className="warn">1</b><small>Metadata review</small></div></div>
      <div className="queue-panel"><div className="queue-title"><h2>In progress</h2><span>3 items</span></div>{jobs.map((job) => <Job key={job.title} job={job}/>)}</div>
      <div className="review-card"><div className="review-art cover cover-green"><span>TIGER'S<br/>BLOOD</span><small>WAXAHATCHEE</small></div><div><p className="eyebrow peach">Review required</p><h2>2 possible metadata matches</h2><p><strong>Tigers Blood</strong> · edition unresolved · import paused</p></div><button className="primary">Review match <ChevronRight size={17}/></button></div>
    </section>
  )
}

function DiscoverView({ setSelected }) {
  const suggestions = [...releases].reverse()
  return (
    <section className="page-view">
      <div className="page-title discover-title"><div><p className="eyebrow">Connected sources</p><h1>Acquire</h1></div></div>
      <div className="mood-row"><button>Electronic <span>↗</span></button><button>Jazz <span>↗</span></button><button>Folk <span>↗</span></button><button>Experimental <span>↗</span></button></div>
      <div className="section-heading"><div><p className="eyebrow">Similar to Broadcast</p><h2>Related releases</h2></div><button>Refresh <Shuffle size={16}/></button></div>
      <div className="release-grid discover-grid">{suggestions.map(r => <ReleaseCard key={r.title} release={r} setSelected={setSelected}/>)}</div>
      <div className="radar-card"><div className="radar-icon"><Radio size={26}/></div><div><p className="eyebrow peach">Release monitor</p><h2>3 new releases</h2><p>Metadata refresh: 2 hours ago</p></div><button className="light-btn">View releases</button></div>
    </section>
  )
}

function SyncView() {
  return (
    <section className="page-view">
      <div className="page-title"><div><p className="eyebrow">Device content plan</p><h1>Sync list</h1><p>Sony NW-A55 · 128 GB microSD · 38.7 GB available</p></div><button className="primary"><ArrowDownToLine size={17}/> Sync 46 tracks</button></div>
      <div className="stats-row"><div><span>Selected</span><b>7,888</b><small>tracks after sync</small></div><div><span>Pending</span><b>46</b><small>1.1 GB · ~6 min</small></div><div><span>Profile</span><b>FLAC</b><small>compatible files copied directly</small></div></div>
      <div className="queue-panel sync-list-panel"><div className="queue-title"><h2>Pending changes</h2><span>3 releases</span></div>{syncItems.map((item) => <div className="sync-row" key={item.title}><span className={`sync-action ${item.action.toLowerCase()}`}>{item.action}</span><div><strong>{item.title}</strong><small>{item.artist} · {item.detail}</small></div><b>{item.size}</b></div>)}</div>
      <div className="sync-policy"><div><p className="eyebrow">NW-A55 profile</p><h2>Preserve compatible audio</h2><p>FLAC direct copy · Embedded baseline JPEG artwork · ReplayGain tags preserved</p></div><button className="outline-btn"><Settings size={16}/> Edit policy</button></div>
    </section>
  )
}

function LibraryView({ setSelected }) {
  return (
    <section className="page-view"><div className="page-title"><div><p className="eyebrow">Indexed media</p><h1>Library</h1><p>1,284 albums · 14,892 tracks · 38 days</p></div><div className="view-controls"><button className="outline-btn"><SlidersHorizontal size={16}/> Filter</button><button className="primary"><Plus size={17}/> Add music</button></div></div><div className="library-toolbar"><div><button className="active">Recently added</button><button>Artist</button><button>Year</button><button>Most played</button></div><span>Showing 1–5 of 1,284</span></div><div className="release-grid library-grid">{releases.map(r => <ReleaseCard key={r.title} release={r} setSelected={setSelected}/>)}</div></section>
  )
}

function AlbumModal({ release, close }) {
  if (!release) return null
  const wanted = release.status === 'Wanted'
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="album-modal" onMouseDown={e => e.stopPropagation()}>
        <button className="modal-close" onClick={close}><X size={20}/></button>
        <div className={`album-header header-${release.color}`}><Cover release={release} size="large"/><div><p className="eyebrow">{release.tag} · {release.year}</p><h1>{release.title}</h1><h2>{release.artist}</h2><div className="modal-actions"><button className="light-btn"><Play size={17} fill="currentColor"/> Play</button><button className={wanted ? 'primary' : 'glass-btn'}>{wanted ? <><ArrowDownToLine size={17}/> Find album</> : <><Check size={17}/> In library</>}</button><button className="glass-icon"><MoreHorizontal size={19}/></button></div></div></div>
        <div className="track-list">{tracks.map(([n,title,time])=><button key={n}><span>{n}</span><Play size={14}/><strong>{title}</strong><small>{time}</small><MoreHorizontal size={16}/></button>)}</div>
        <div className="album-info"><div><span>Format</span><strong>FLAC · 24-bit / 96 kHz</strong></div><div><span>Source</span><strong>MusicBrainz + local tags</strong></div><div><span>Added</span><strong>12 June 2026</strong></div></div>
      </div>
    </div>
  )
}

function Player() {
  const [playing, setPlaying] = useState(true)
  return (
    <footer className="player">
      <div className="now-playing"><div className="mini-cover">ID</div><div><strong>Image</strong><span>Magdalena Bay</span></div><button><Heart size={17}/></button></div>
      <div className="player-center"><div className="player-controls"><button><Shuffle size={16}/></button><button><SkipBack size={18} fill="currentColor"/></button><button className="main-play" onClick={()=>setPlaying(!playing)}>{playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button><button><SkipForward size={18} fill="currentColor"/></button><button><Radio size={16}/></button></div><div className="timeline"><span>1:42</span><div><i/></div><span>3:33</span></div></div>
      <div className="player-right"><button><ListMusic size={18}/></button><Volume2 size={18}/><div className="volume"><i/></div><button><Maximize2 size={17}/></button></div>
    </footer>
  )
}

function App() {
  const [view, setView] = useState('home')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const filteredReleases = useMemo(() => releases.filter(r => `${r.title} ${r.artist}`.toLowerCase().includes(query.toLowerCase())), [query])
  return (
    <div className="app-shell">
      <div className="world-objects" aria-hidden="true">
        <div className="floating-cd"><i/><span/></div>
        <div className="floating-headphones"><i/><i/><b/></div>
        <div className="floating-cable"><i/><span/></div>
      </div>
      <Sidebar view={view} setView={setView}/>
      <div className="content-shell"><Topbar query={query} setQuery={setQuery}/><main>
        {view === 'home' && <HomeView setSelected={setSelected} setView={setView} filteredReleases={filteredReleases}/>} 
        {view === 'activity' && <ActivityView/>}
        {view === 'discover' && <DiscoverView setSelected={setSelected}/>} 
        {view === 'library' && <LibraryView setSelected={setSelected}/>} 
        {view === 'wanted' && <SyncView/>}
      </main></div>
      <AlbumModal release={selected} close={()=>setSelected(null)}/>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
