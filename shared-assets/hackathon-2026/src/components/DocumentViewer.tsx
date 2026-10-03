import { useState } from 'react'
import {
  ZoomIn, ZoomOut, Download, FileText, Loader, Maximize2, Minimize2, AlertOctagon, X,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || ''

type Props = {
  caseId?: string
  filename?: string
  onClose?: () => void
  embedded?: boolean
}

export function DocumentViewer({ caseId, filename, onClose, embedded = false }: Props) {
  const [zoom, setZoom] = useState(100)
  const [fullscreen, setFullscreen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  const url = caseId ? `${API_BASE}/api/archive/pdf/${encodeURIComponent(caseId)}` : null
  const displayName = filename || (caseId ? `${caseId}.pdf` : '—')

  const zoomIn = () => setZoom((z) => Math.min(z + 25, 200))
  const zoomOut = () => setZoom((z) => Math.max(z - 25, 50))

  if (!caseId) {
    return (
      <div className={`docviewer docviewer-empty ${embedded ? 'embedded' : ''}`}>
        <FileText size={28} className="raven-muted" />
        <p className="raven-muted docviewer-empty-hd">No document linked</p>
        <p className="raven-muted docviewer-empty-sub">
          Upload a document or select a persisted case with an archived source PDF.
        </p>
      </div>
    )
  }

  return (
    <div className={`docviewer ${fullscreen ? 'fullscreen' : ''} ${embedded ? 'embedded' : ''}`} role="region" aria-label="Source document viewer">
      <div className="docviewer-toolbar">
        <div className="docviewer-name">
          <FileText size={14} />
          <span className="docviewer-file">{displayName}</span>
          <span className="docviewer-typechip">PDF</span>
        </div>
        <div className="docviewer-tools">
          <button className="icon-btn" aria-label="Zoom out" onClick={zoomOut} disabled={zoom <= 50}><ZoomOut size={13} /></button>
          <span className="docviewer-zoom">{zoom}%</span>
          <button className="icon-btn" aria-label="Zoom in" onClick={zoomIn} disabled={zoom >= 200}><ZoomIn size={13} /></button>
          <span className="docviewer-sep" />
          <a className="icon-btn" href={url!} download={displayName} aria-label="Download PDF"><Download size={13} /></a>
          <button
            className="icon-btn"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => setFullscreen((p) => !p)}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {onClose && (
            <button className="icon-btn" aria-label="Close viewer" onClick={onClose}><X size={13} /></button>
          )}
        </div>
      </div>

      <div className="docviewer-body">
        {!loaded && !error && (
          <div className="docviewer-overlay">
            <Loader size={22} className="docviewer-spin" />
            <span className="raven-muted docviewer-loading">Loading PDF…</span>
          </div>
        )}
        {error ? (
          <div className="docviewer-overlay docviewer-overlay-err">
            <AlertOctagon size={26} />
            <p>Source document unavailable</p>
            <small className="raven-muted">The case has no persisted source PDF, or the archive route returned 404.</small>
          </div>
        ) : (
          <iframe
            src={`${url}#zoom=${zoom}`}
            title="Source document"
            className="docviewer-frame"
            onLoad={() => setLoaded(true)}
            onError={() => { setLoaded(true); setError(true) }}
          />
        )}
      </div>
    </div>
  )
}

export default DocumentViewer
