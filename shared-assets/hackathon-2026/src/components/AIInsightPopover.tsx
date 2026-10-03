import { useEffect, useState } from 'react'
import { X, Sparkles, ShieldCheck, Cpu, Users, Loader, AlertOctagon, Check } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || ''

type Props = {
  caseId: string
  onClose: () => void
  onAddSuggestion?: (payload: any) => void
}

type TaxResult = {
  analyzer?: string
  status?: string
  provider?: string
  model?: string
  result?: {
    suggested_vat_rate?: number | null
    suggested_account?: string | null
    vat_status?: string
    vat_reason?: string
    arithmetic_status?: string
    match_assessment?: string
    risk_flags?: string[]
    confidence?: number
    summary?: string
    reason?: string
    do_not_approve?: boolean
    erp_write?: boolean
    human_review_required?: boolean
  }
  policy?: { authority?: string; approval_eligible?: boolean; erp_action_allowed?: boolean }
}

type CouncilStage = {
  model?: string
  stage?: string
  status?: string
  output?: any
}
type CouncilResult = {
  analyzer?: string
  status?: string
  stages?: CouncilStage[]
  retrieved_context?: Array<{ ref_id?: string; supplier?: string; similarity?: number; authority?: string }>
  reason?: string
  council_lead?: string
  apertus_slot?: { model?: string; status?: string; note?: string }
}

/**
 * AIInsightPopover — live Apertus tax analysis + Qwen/Gemma council for one case.
 *
 * Fetches BOTH in parallel and renders each honestly. Every advisory field is
 * labeled AI ADVISORY, deterministic re-derivations aren't overridden here,
 * approval requires human confirmation via onAddSuggestion (which the parent
 * routes through the backend's approval endpoint).
 */
export function AIInsightPopover({ caseId, onClose, onAddSuggestion }: Props) {
  const [tax, setTax] = useState<TaxResult | null>(null)
  const [council, setCouncil] = useState<CouncilResult | null>(null)
  const [taxErr, setTaxErr] = useState<string>('')
  const [councilErr, setCouncilErr] = useState<string>('')
  const [taxBusy, setTaxBusy] = useState(true)
  const [councilBusy, setCouncilBusy] = useState(true)

  useEffect(() => {
    // Tax runs fast (~2 s on H100 vLLM). Council is variable — sparse-evidence
    // cases can hit the per-stage 30 s ceiling. Cap the client-side wait at
    // 20 s per call so the popover always renders honestly.
    const call = async (
      level: 'tax' | 'council',
      setBusy: (b: boolean) => void,
      setResult: (v: any) => void,
      setErr: (s: string) => void,
      timeoutMs: number,
    ) => {
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        const r = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(caseId)}/investigate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Advisory-Level': level },
          body: JSON.stringify({ question: level === 'tax' ? 'Swiss VAT + booking suggestion?' : 'Council review of this case.' }),
          signal: ctrl.signal,
        })
        const body = await r.json()
        if (!r.ok) throw new Error(body?.detail?.detail || body?.detail || `HTTP ${r.status}`)
        setResult(body)
      } catch (e) {
        const err = e as Error
        if (err.name === 'AbortError') {
          setErr(`Timed out after ${Math.round(timeoutMs / 1000)}s — model still warming or evidence is sparse. Apertus result above is complete.`)
        } else {
          setErr(err.message)
        }
      } finally {
        window.clearTimeout(t)
        setBusy(false)
      }
    }
    setTax(null); setCouncil(null); setTaxErr(''); setCouncilErr(''); setTaxBusy(true); setCouncilBusy(true)
    call('tax', setTaxBusy, setTax, setTaxErr, 30_000)
    call('council', setCouncilBusy, setCouncil, setCouncilErr, 20_000)
  }, [caseId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const taxResult = tax?.result || {}
  const humanReviewRequired = taxResult.human_review_required !== false
  const doNotApprove = taxResult.do_not_approve !== false

  const handleAddSuggestion = () => {
    if (!onAddSuggestion) return
    onAddSuggestion({
      case_id: caseId,
      apertus: taxResult,
      council: {
        status: council?.status,
        lead: council?.council_lead,
        stages: (council?.stages || []).map((s) => ({ model: s.model, stage: s.stage, status: s.status })),
      },
      human_review_required: true,
      erp_write: false,
    })
  }

  return (
    <>
      <div className="ai-pop-scrim" onClick={onClose} aria-hidden />
      <div className="ai-pop" role="dialog" aria-label="AI advisory for case">
        <div className="ai-pop-head">
          <div>
            <div className="ai-pop-eyebrow">AI ADVISORY · human review required</div>
            <div className="ai-pop-title">{caseId}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>

        <div className="ai-pop-body">
          {/* --- Apertus tax analysis --- */}
          <div className="ai-pop-section origin-hypotheses">
            <div className="origin-header origin-header-hypotheses">
              <Sparkles size={12} /> <span>Apertus · Swiss tax analysis</span>
              <small className="raven-muted ai-pop-model">swiss-ai/Apertus-v1.5-8B · vLLM · GPU 0</small>
            </div>
            {taxBusy ? (
              <div className="ai-pop-loading"><Loader size={16} className="spin-slow" /> Calling Apertus…</div>
            ) : taxErr ? (
              <div className="ai-pop-err"><AlertOctagon size={13} /> {taxErr}</div>
            ) : (
              <>
                <table className="ai-pop-facts">
                  <tbody>
                    <tr><td>Suggested VAT rate</td><td className="ai-pop-val">{taxResult.suggested_vat_rate ?? <em className="raven-muted">insufficient evidence</em>}</td></tr>
                    <tr><td>Suggested account (KMU)</td><td className="ai-pop-val">{taxResult.suggested_account ?? <em className="raven-muted">insufficient evidence</em>}</td></tr>
                    <tr><td>VAT status</td><td><span className={`pill ${taxResult.vat_status === 'consistent' ? 'pill-green' : 'pill-amber'}`}>{taxResult.vat_status || 'unknown'}</span></td></tr>
                    <tr><td>Arithmetic</td><td><span className={`pill ${taxResult.arithmetic_status === 'consistent' ? 'pill-green' : taxResult.arithmetic_status === 'inconsistent' ? 'pill-red' : 'pill-amber'}`}>{taxResult.arithmetic_status || 'not_checked'}</span></td></tr>
                    <tr><td>Match assessment</td><td><span className="pill pill-amber">{taxResult.match_assessment || 'not_checked'}</span></td></tr>
                    <tr><td>Model confidence</td><td className="ai-pop-val">{typeof taxResult.confidence === 'number' ? `${(taxResult.confidence * 100).toFixed(0)}%` : '—'}</td></tr>
                  </tbody>
                </table>
                {taxResult.reason && <p className="ai-pop-reason"><ShieldCheck size={11} /> {taxResult.reason}</p>}
                {(taxResult.risk_flags || []).length > 0 && (
                  <div className="ai-pop-flags">
                    {(taxResult.risk_flags || []).map((f) => <span key={f} className="pill pill-red">{f}</span>)}
                  </div>
                )}
              </>
            )}
          </div>

          {/* --- Council (Qwen + Gemma) --- */}
          <div className="ai-pop-section origin-hypotheses">
            <div className="origin-header origin-header-hypotheses">
              <Users size={12} /> <span>Council · Qwen3 + Gemma3 cross-check</span>
              <small className="raven-muted ai-pop-model">Ollama · qwen3:32b + gemma3:27b</small>
            </div>
            {councilBusy ? (
              <div className="ai-pop-loading"><Loader size={16} className="spin-slow" /> Running council…</div>
            ) : councilErr ? (
              <div className="ai-pop-err"><AlertOctagon size={13} /> {councilErr}</div>
            ) : (
              <>
                <div className="ai-pop-council-head">
                  <span>Status</span>
                  <span className={`pill ${council?.status === 'ok' || council?.status === 'analyzed' ? 'pill-green' : 'pill-amber'}`}>{council?.status || 'unknown'}</span>
                  {council?.council_lead && <small className="raven-muted">lead: {council.council_lead}</small>}
                </div>
                {(council?.stages || []).length > 0 && (
                  <ul className="ai-pop-stages">
                    {(council?.stages || []).map((s, i) => (
                      <li key={i}>
                        <Cpu size={11} /> <b>{s.model}</b> <span className="raven-muted">/ {s.stage}</span> — <span className={`pill ${s.status === 'ok' ? 'pill-green' : 'pill-amber'}`}>{s.status || '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {council?.apertus_slot && (
                  <div className="ai-pop-apertus-slot">
                    <small className="raven-muted">Apertus slot: <code>{council.apertus_slot.model}</code> — {council.apertus_slot.status}</small>
                    {council.apertus_slot.note && <small className="raven-muted">{council.apertus_slot.note}</small>}
                  </div>
                )}
                {(council?.retrieved_context || []).length > 0 && (
                  <div className="ai-pop-rag">
                    <small className="raven-muted">RAG evidence-candidates:</small>
                    <ul>
                      {(council?.retrieved_context || []).slice(0, 3).map((r, i) => (
                        <li key={i}><code>{r.ref_id}</code> — {r.supplier || 'unknown supplier'} · similarity {(r.similarity ?? 0).toFixed(2)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>

          {/* --- Human review gate --- */}
          <div className="ai-pop-review">
            <ShieldCheck size={13} /> Human approval required · <code>erp_write: false</code>
          </div>
        </div>

        <div className="ai-pop-actions">
          <button
            className="ai-pop-btn primary"
            onClick={handleAddSuggestion}
            disabled={taxBusy || (!!taxErr && !!councilErr) || doNotApprove}
            title={doNotApprove ? 'Apertus flagged this case for human review — cannot auto-add.' : 'Record the Apertus + council suggestion as an advisory correction for this case.'}
          >
            <Check size={13} /> Add suggestion
          </button>
          <button className="ai-pop-btn" onClick={onClose}>
            Flag for review
          </button>
          <button className="ai-pop-btn ghost" onClick={onClose}>
            Skip
          </button>
          {humanReviewRequired && <small className="raven-muted ai-pop-hint">Even after Add: a human reviewer must approve in Morgiana.</small>}
        </div>
      </div>
    </>
  )
}

export default AIInsightPopover
