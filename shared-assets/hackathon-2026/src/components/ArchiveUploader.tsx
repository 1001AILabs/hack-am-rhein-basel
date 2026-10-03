import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, FileText, Loader, RefreshCw, CheckCircle2, AlertOctagon } from 'lucide-react'
import { AIInsightPopover } from './AIInsightPopover'

const API_BASE = import.meta.env.VITE_API_URL || ''

type ArchiveKind = 'invoice' | 'bank_transaction'

type ArchiveCase = {
  case_id: string
  case_type?: string
  supplier?: string | null
  invoice_number?: string | null
  invoice_date?: string | null
  gross_amount?: string | null
  currency?: string | null
  risk_flags?: string[]
  review_state?: string | null
  created_at?: string | null
}

type Props = {
  kind: ArchiveKind
  label: string
  hint: string
}

/**
 * ArchiveUploader — drop a PDF/XML → /process → shows up in the archive.
 *
 * Backend classifies uploads by filename hint (Rechnung/Invoice/... → invoice;
 * CAMT/Kontoauszug/Statement/... → bank_transaction) and the archive endpoint
 * filters by case_type. So the same uploader wired on two tabs routes each
 * upload to the correct tab automatically.
 */
export function ArchiveUploader({ kind, label, hint }: Props) {
  const [cases, setCases] = useState<ArchiveCase[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [lastError, setLastError] = useState<string>('')
  const [lastOk, setLastOk] = useState<string>('')
  const [popCaseId, setPopCaseId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setLastError('')
    try {
      const r = await fetch(`${API_BASE}/api/archive/cases?case_type=${kind}&limit=25`)
      if (!r.ok) throw new Error(`archive ${r.status}`)
      const d = await r.json()
      setCases(d.cases || [])
    } catch (e) {
      setLastError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [kind])

  useEffect(() => { refresh() }, [refresh])

  /** Batch upload — sequential POST /process per file, single UI refresh. */
  const uploadMany = async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    setLastError('')
    setLastOk('')
    setBatchProgress({ done: 0, total: files.length })
    const results: Array<{ name: string; case_id?: string; ok: boolean; err?: string }> = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const fd = new FormData()
        fd.append('file', file)
        const r = await fetch(`${API_BASE}/process`, { method: 'POST', body: fd })
        const body = await r.json().catch(() => ({}))
        if (!r.ok) {
          const detail = body?.detail?.detail || body?.detail || `HTTP ${r.status}`
          results.push({ name: file.name, ok: false, err: String(detail) })
        } else {
          results.push({ name: file.name, ok: true, case_id: body.case_id })
        }
      } catch (e) {
        results.push({ name: file.name, ok: false, err: (e as Error).message })
      }
      setBatchProgress({ done: i + 1, total: files.length })
    }
    const ok = results.filter((r) => r.ok).length
    const fail = results.length - ok
    if (fail === 0) {
      setLastOk(`Batch complete · ${ok} of ${files.length} processed and archived.`)
    } else if (ok === 0) {
      setLastError(`Batch failed · 0 of ${files.length} accepted. First error: ${results[0].err}`)
    } else {
      setLastOk(`${ok} of ${files.length} processed. ${fail} rejected (see backend log).`)
    }
    window.dispatchEvent(new CustomEvent('raven:archive-updated', { detail: { kind } }))
    await refresh()
    setUploading(false)
    setBatchProgress(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || [])
    if (list.length > 0) uploadMany(list)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const list = Array.from(e.dataTransfer.files || [])
    if (list.length > 0) uploadMany(list)
  }

  // Listen for uploads from the OTHER tab and refresh if applicable.
  useEffect(() => {
    const onUpdate = () => refresh()
    window.addEventListener('raven:archive-updated', onUpdate as EventListener)
    return () => window.removeEventListener('raven:archive-updated', onUpdate as EventListener)
  }, [refresh])

  return (
    <section className="raven-card archive-uploader">
      <div className="card-head">
        <h3><Upload size={14} /> {label}</h3>
        <button
          className="icon-btn"
          onClick={refresh}
          aria-label="Refresh"
          disabled={loading || uploading}
          title="Refresh archive list"
        >
          <RefreshCw size={13} className={loading ? 'spin-slow' : ''} />
        </button>
      </div>

      <div
        className={`archive-drop ${uploading ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault() }}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Drop file or click to upload"
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept=".pdf,.xml,.png,.jpg,.jpeg,.tiff,.tif"
          onChange={handleFile}
        />
        {uploading ? (
          <div className="archive-drop-busy">
            <Loader size={18} className="spin-slow" />
            <span>
              {batchProgress
                ? `Processing ${batchProgress.done} of ${batchProgress.total}…`
                : 'Processing…'}
            </span>
            <div className="archive-drop-shimmer" aria-hidden />
          </div>
        ) : (
          <>
            <Upload size={18} />
            <span>Drop one or more files here, or click to select</span>
            <small className="raven-muted">{hint}</small>
          </>
        )}
      </div>

      {lastError && (
        <div className="archive-msg archive-err"><AlertOctagon size={13} /> {lastError}</div>
      )}
      {lastOk && !lastError && (
        <div className="archive-msg archive-ok"><CheckCircle2 size={13} /> {lastOk}</div>
      )}

      <div className="archive-table-wrap">
        {cases.length === 0 && !loading ? (
          <div className="raven-muted archive-empty"><FileText size={18} /> No archived {kind === 'invoice' ? 'invoices' : 'bank transactions'} yet. Upload one to see it here.</div>
        ) : (
          <table className="archive-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>{kind === 'invoice' ? 'Supplier' : 'Counterparty'}</th>
                <th>{kind === 'invoice' ? 'Invoice #' : 'Reference'}</th>
                <th>{kind === 'invoice' ? 'Date' : 'Booked'}</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {cases.slice(0, 25).map((c) => {
                const flags = c.risk_flags || []
                const pillTone = flags.length === 0 ? 'green'
                  : flags.some((f) => /BLOCK|MISSING|MISMATCH|INJECTION/i.test(f)) ? 'red'
                  : 'amber'
                return (
                  <tr key={c.case_id} className="archive-row" onClick={() => setPopCaseId(c.case_id)} tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPopCaseId(c.case_id) } }}
                    title="Click to open Apertus + council AI advisory"
                  >
                    <td><code className="raven-mono">{c.case_id}</code></td>
                    <td>{c.supplier || <span className="raven-muted">—</span>}</td>
                    <td>{c.invoice_number || <span className="raven-muted">—</span>}</td>
                    <td>{c.invoice_date || <span className="raven-muted">—</span>}</td>
                    <td className="tabular" style={{ textAlign: 'right' }}>
                      {c.gross_amount ? `${c.currency || 'CHF'} ${c.gross_amount}` : <span className="raven-muted">—</span>}
                    </td>
                    <td>
                      {flags.length === 0
                        ? <span className={`pill pill-${pillTone}`}>clean</span>
                        : <span className={`pill pill-${pillTone}`}>{flags[0]}</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {popCaseId && (
        <AIInsightPopover
          caseId={popCaseId}
          onClose={() => setPopCaseId(null)}
          onAddSuggestion={(payload) => {
            setLastOk(`Suggestion recorded for ${payload.case_id}. Human approval still required.`)
            setPopCaseId(null)
          }}
        />
      )}
    </section>
  )
}

export default ArchiveUploader
