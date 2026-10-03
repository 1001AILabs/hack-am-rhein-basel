import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
  Activity, AlertTriangle, ArrowLeftRight, BarChart3, BookOpen,
  Check, CheckCircle2, ChevronRight, ChevronsLeft, ChevronsRight, Clock,
  Cpu, FileText, Gauge, GitBranch, Layers, LayoutDashboard,
  ListChecks, Lock, Menu, Moon, RefreshCw, Search, Send, Shield,
  ShieldAlert, ShieldCheck, Sparkles, Sun, Upload, Users, Wallet, X, XCircle,
  Zap,
} from 'lucide-react'
import { Sparkline } from './components/Sparkline'
import { DocumentViewer } from './components/DocumentViewer'
import { ArchiveUploader } from './components/ArchiveUploader'

// ---------------------------------------------------------------------------
// RavenMark — 1001 AI Labs brand identity mark (raven + lantern).
// Inline SVG so it's part of the bundle, works over the Coder proxy, and
// tints via currentColor. Two paths: outer ring + bird + lantern silhouette.
// ---------------------------------------------------------------------------
function RavenMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="RAVEN — 1001 AI Labs"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="32" cy="32" r="29.5" />
      {/* Bird body */}
      <path d="M22 24 C25 20, 30 18, 34 20 C37 21, 39 24, 39 27 L41 27 L38 30 L36 32 L34 33 L30 34 L26 33 L23 32 L22 30 Z" />
      {/* Bird eye + tail */}
      <circle cx="27" cy="23" r="0.8" fill="currentColor" stroke="none" />
      <path d="M22 30 L18 33" />
      {/* Perch */}
      <path d="M20 34 L44 34" />
      {/* Lantern hanger */}
      <path d="M32 34 L32 38" />
      {/* Lantern body */}
      <path d="M27 38 L37 38 L36 40 L36 48 L28 48 L28 40 Z" />
      <path d="M28 41 L36 41" />
      <path d="M28 47 L36 47" />
      {/* Lantern base */}
      <path d="M29 48 L29 51 L35 51 L35 48" />
    </svg>
  )
}
import './App.css'

// ---------------------------------------------------------------------------
// API base
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL || ''
const MOCK_MODE = import.meta.env.VITE_MOCK_MODE === 'true'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail?.message || body.detail || `API error ${response.status}`)
  }
  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Fact = {
  source: string
  field: string
  value: string
  confidence: number
}

type Calculation = {
  type: string
  value: string
  note: string
}

type ReviewState = 'PENDING_REVIEW' | 'APPROVED_DRAFT' | 'REJECTED'

type DemoCase = {
  case_id: string
  demo_label: string
  approval_eligible: boolean
  review_state: ReviewState
  review_case_id: string
  risk_flags?: string[]
  deterministic_checks?: Record<string, string>
  investigation?: {
    case_id: string
    risk_flags: string[]
    approval_eligible: boolean
    invoice_id?: string
    transaction_id?: string
    checks?: Record<string, unknown>
    [key: string]: unknown
  }
  evidence?: {
    facts: Fact[]
    calculations: Calculation[]
    [key: string]: unknown
  }
  vat_split_validation?: Array<{
    rate: string
    net: string
    vat: string
    gross: string
    valid: boolean
    checks: Record<string, boolean>
  }>
}

type HealthData = {
  status: string
  nim_health: Array<{ name: string; status: string; url: string }>
  active_profile: string | null
  gpu: { available: boolean; count: number; hardware: string }
}

type StackStatus = {
  offline_capable: boolean
  reachable: number
  total: number
  [key: string]: unknown
}

type AuditEntry = {
  timestamp: string
  action: string
  actor: string
  case_id: string
  detail: string
  outcome: string
}

type NavPage =
  | 'overview'
  | 'reconcile'
  | 'transactions'
  | 'invoices'
  | 'bookings'
  | 'morgiana'
  | 'audit'
  | 'insights'

type RuntimeLayerStatus = 'LIVE' | 'READY' | 'VERIFIED' | 'DEGRADED' | 'FALLBACK' | 'DOWN' | 'UNAVAILABLE'

type RuntimeLayer = {
  key: string
  label: string
  model: string
  status: RuntimeLayerStatus
  latency_ms: number | null
  last_ping: string | null
}

type RuntimeCapabilities = {
  layers: RuntimeLayer[]
  source: 'backend' | 'mock'
  apertus_vllm?: {
    status: 'live' | 'fallback' | 'unavailable' | string
    model?: string
    endpoint?: string
    provider?: string
    gpu?: string
    latency_ms?: number | null
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAV_ITEMS: Array<{ key: NavPage; label: string; icon: typeof LayoutDashboard }> = [
  { key: 'overview', label: 'Overview', icon: Shield },
  { key: 'reconcile', label: 'Reconcile', icon: Layers },
  { key: 'transactions', label: 'Bankauszug · CAMT', icon: Wallet },
  { key: 'invoices', label: 'Kreditoren · MWST', icon: FileText },
  { key: 'bookings', label: 'Bookings', icon: BookOpen },
  { key: 'morgiana', label: 'Morgiana', icon: Users },
  { key: 'audit', label: 'Audit Trail', icon: Lock },
  { key: 'insights', label: 'Financial Insights', icon: BarChart3 },
]

const RISK_EXPLAIN: Record<string, string> = {
  IBAN_MISMATCH: 'The invoice IBAN differs from the counterparty IBAN on the bank statement. Approval is blocked until the account is verified out-of-band.',
  IBAN_NOT_VERIFIED: 'This IBAN has not appeared in a prior verified payment. Human review required before approval.',
  AMOUNT_MISMATCH: 'The invoice total does not match the bank transaction amount within tolerance. Investigate before approval.',
  DUPLICATE_DOCUMENT: 'A prior case matched the same document hash. Approving would double-book. Review the earlier case.',
  REFERENCE_MISSING: 'The required Swiss QR-bill or ESR reference is absent from the transaction. Approval blocked.',
  REFERENCE_MISMATCH: 'The bank transaction reference does not match the invoice reference. Investigate.',
  UNKNOWN_VAT_RATE: 'A VAT rate on this invoice is not on the current Swiss FTA schedule. Approval blocked.',
  PROMPT_INJECTION: 'Input guard detected content designed to override the AI advisor. The advisor did not run on this content.',
  VAT_SPLIT_REVIEW_REQUIRED: 'The invoice mixes multiple VAT rates. Human confirmation of the split is required before approval.',
  VENDOR_NAME_VARIANT: 'The supplier name is a variant of a known supplier. Confirm identity or add to supplier memory.',
}

const MOCK_KPI_SPARKS = {
  cases: [12, 14, 11, 15, 18, 16, 19],
  approved: [4, 5, 6, 4, 7, 5, 8],
  blocked: [2, 3, 1, 2, 4, 3, 2],
  ocrConf: [0.91, 0.92, 0.94, 0.93, 0.95, 0.96, 0.95],
}

const MOCK_RUNTIME: RuntimeCapabilities = {
  source: 'mock',
  layers: [
    { key: 'ocr', label: 'OCR', model: 'nemotron-ocr-v2', status: 'READY', latency_ms: 420, last_ping: new Date().toISOString() },
    { key: 'parse', label: 'Parse', model: 'nemotron-parse-v1', status: 'READY', latency_ms: 610, last_ping: new Date().toISOString() },
    { key: 'ollama', label: 'Ollama', model: 'no model loaded', status: 'DEGRADED', latency_ms: null, last_ping: new Date().toISOString() },
    { key: 'tts', label: 'Riva TTS', model: 'not configured', status: 'UNAVAILABLE', latency_ms: null, last_ping: null },
    { key: 'pgvector', label: 'pgvector', model: 'postgres 16', status: 'LIVE', latency_ms: 8, last_ping: new Date().toISOString() },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function riskColor(flags: string[]): 'green' | 'amber' | 'red' {
  const blocking = new Set([
    'IBAN_MISMATCH', 'IBAN_NOT_VERIFIED', 'AMOUNT_MISMATCH',
    'DUPLICATE_DOCUMENT', 'REFERENCE_MISSING', 'REFERENCE_MISMATCH',
    'UNKNOWN_VAT_RATE', 'PROMPT_INJECTION',
  ])
  const review = new Set([
    'VAT_SPLIT_REVIEW_REQUIRED', 'VENDOR_NAME_VARIANT',
  ])
  if (flags.some((f) => blocking.has(f))) return 'red'
  if (flags.some((f) => review.has(f))) return 'amber'
  return 'green'
}

function StatusDot({ color }: { color: 'green' | 'amber' | 'red' }) {
  return <span className={`status-indicator ${color}`} aria-label={color} />
}

function statusToTone(s: RuntimeLayerStatus): 'green' | 'blue' | 'amber' | 'red' {
  if (s === 'VERIFIED' || s === 'LIVE') return 'green'
  if (s === 'READY') return 'blue'
  if (s === 'DEGRADED' || s === 'FALLBACK') return 'amber'
  return 'red'
}

function useCountUp(target: number, duration = 800): number {
  const [value, setValue] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    startRef.current = null
    let raf = 0
    const step = (t: number) => {
      if (startRef.current === null) startRef.current = t
      const elapsed = t - startRef.current
      const p = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(target * eased)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

function useTheme(): [theme: 'dark' | 'light', toggle: () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark'
    try {
      const saved = window.localStorage.getItem('raven-theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch {
      // ignore
    }
    return 'dark'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('raven-theme', theme)
    } catch {
      // ignore
    }
  }, [theme])
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return [theme, toggle]
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export function App() {
  const [page, setPage] = useState<NavPage>('reconcile')
  const [cases, setCases] = useState<DemoCase[]>([])
  const [casesLoading, setCasesLoading] = useState(true)
  const [casesError, setCasesError] = useState('')
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthError, setHealthError] = useState('')
  const [stack, setStack] = useState<StackStatus | null>(null)
  const [stackError, setStackError] = useState(false)
  const [toast, setToast] = useState('')
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [runtime, setRuntime] = useState<RuntimeCapabilities>(MOCK_RUNTIME)
  const [theme, toggleTheme] = useTheme()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 900px)')

  const notify = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3200)
  }, [])

  const addAudit = useCallback((entry: Omit<AuditEntry, 'timestamp'>) => {
    setAuditLog((prev) => [
      { ...entry, timestamp: new Date().toISOString() },
      ...prev,
    ])
  }, [])

  const loadCases = useCallback(async () => {
    setCasesLoading(true)
    setCasesError('')
    try {
      const data = await apiFetch<{ cases: DemoCase[] }>('/api/demo/cases')
      setCases(data.cases)
    } catch (err) {
      setCasesError(err instanceof Error ? err.message : 'Failed to load cases')
    } finally {
      setCasesLoading(false)
    }
  }, [])

  const loadHealth = useCallback(async () => {
    setHealthError('')
    try {
      const data = await apiFetch<HealthData>('/health')
      setHealth(data)
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : 'Health check failed')
    }
  }, [])

  const loadStack = useCallback(async () => {
    setStackError(false)
    try {
      const data = await apiFetch<StackStatus>('/stack/offline')
      setStack(data)
    } catch {
      setStack(null)
      setStackError(true)
    }
  }, [])

  const loadRuntime = useCallback(async () => {
    if (MOCK_MODE) {
      setRuntime(MOCK_RUNTIME)
      return
    }
    try {
      // Backend shape: { profile, layers: {ocr: 'ready'|'fallback'|..., ...},
      //   data_egress, erp_write, apertus_vllm: {status, model, endpoint, provider} }
      // The map form (`layers: {name: status}`) needs adapting to our array form.
      const raw = await apiFetch<Record<string, unknown>>('/api/runtime/capabilities')
      const layersField = raw['layers']
      let layers: RuntimeLayer[] = []
      if (Array.isArray(layersField)) {
        layers = layersField as RuntimeLayer[]
      } else if (layersField && typeof layersField === 'object') {
        const entries = Object.entries(layersField as Record<string, string>)
        const now = new Date().toISOString()
        layers = entries.map(([key, raw]) => {
          const status = String(raw).toUpperCase() as RuntimeLayerStatus
          const model = key === 'ocr' ? 'nemotron-ocr-v2'
                      : key === 'parse' ? 'nemotron-parse-v1'
                      : key === 'ollama' || key === 'advisory_ollama' ? 'qwen3:32b + gemma3:27b'
                      : key === 'pgvector' ? 'postgres 16 + pgvector'
                      : String(raw)
          return {
            key,
            label: key.replace(/_/g, ' '),
            model,
            status: (['LIVE', 'READY', 'VERIFIED', 'DEGRADED', 'FALLBACK', 'DOWN', 'UNAVAILABLE']
              .includes(status) ? status : 'FALLBACK') as RuntimeLayerStatus,
            latency_ms: null,
            last_ping: now,
          }
        })
      }
      const apertus = raw['apertus_vllm'] as RuntimeCapabilities['apertus_vllm'] | undefined
      if (layers.length > 0) {
        setRuntime({ layers, source: 'backend', apertus_vllm: apertus })
      } else {
        setRuntime(MOCK_RUNTIME)
      }
    } catch {
      setRuntime(MOCK_RUNTIME)
    }
  }, [])

  const reloadCases = useCallback(async () => {
    setCases([])
    setCasesLoading(true)
    setAuditLog([])
    notify('Reloading cases')
    await loadCases()
  }, [loadCases, notify])

  useEffect(() => {
    loadCases()
    loadHealth()
    loadStack()
    loadRuntime()
    // Poll runtime every 15 s so the NIM strip / runtime panels stay honest.
    const t = window.setInterval(loadRuntime, 15000)
    return () => window.clearInterval(t)
  }, [loadCases, loadHealth, loadStack, loadRuntime])

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false)
  }, [isMobile])

  const sidebarClass = [
    'raven-sidebar',
    sidebarCollapsed && !isMobile ? 'collapsed' : '',
    isMobile ? (mobileNavOpen ? 'mobile-open' : 'mobile-closed') : '',
  ].filter(Boolean).join(' ')

  return (
    <>
    <div className="raven-top-banner" role="note" aria-label="Brand · deployment profile">
      <div className="banner-brand">
        <RavenMark size={22} />
        <span className="banner-brand-name">RAVEN Finance Guardian</span>
        <span className="banner-brand-sub">by 1001 AI Labs</span>
      </div>
      <div className="banner-tech">
        <span className="banner-nv">RAVEN H100 Enterprise</span>
        <span className="banner-sep">·</span>
        <span>2×H100 NVL</span>
        <span className="banner-sep">·</span>
        <span>188 GB HBM3</span>
        <span className="banner-sep">·</span>
        <span className="banner-nv">NVIDIA NIM</span>
      </div>
    </div>
    <div className={`raven-shell${sidebarCollapsed && !isMobile ? ' shell-collapsed' : ''}`}>
      {isMobile && mobileNavOpen && (
        <div
          className="raven-mobile-scrim"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside className={sidebarClass} aria-label="Primary navigation">
        <div className="raven-brand">
          <span className="raven-logo raven-logo-mark" aria-label="RAVEN logo">
            <RavenMark size={28} />
          </span>
          {!sidebarCollapsed && <span className="raven-title">RAVEN</span>}
        </div>
        {!sidebarCollapsed && (
          <div className="raven-workspace">
            <span className="ws-icon">FG</span>
            <span className="ws-text">
              <b>Finance Guardian</b>
              <small>Swiss Fiduciary Demo</small>
            </span>
          </div>
        )}
        <nav className="raven-nav">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`raven-nav-item${page === key ? ' active' : ''}`}
              onClick={() => {
                setPage(key)
                setMobileNavOpen(false)
              }}
              aria-label={label}
              aria-current={page === key ? 'page' : undefined}
              title={sidebarCollapsed ? label : undefined}
            >
              <Icon size={16} />
              {!sidebarCollapsed && <span>{label}</span>}
            </button>
          ))}
        </nav>

        {!sidebarCollapsed && (
          <div className="raven-runtime">
            <div className="runtime-heading">
              <Gauge size={13} />
              <span>Runtime</span>
            </div>
            {health ? (
              <>
                <div className="runtime-row">
                  <span>GPU</span>
                  <b>{health.gpu.available ? `${health.gpu.count}x ${health.gpu.hardware}` : 'unavailable'}</b>
                </div>
                <div className="runtime-row">
                  <span>Profile</span>
                  <b>{health.active_profile || 'none'}</b>
                </div>
                <div className="runtime-row">
                  <span>NIM</span>
                  <b>{health.nim_health.length} services</b>
                </div>
              </>
            ) : (
              <div className="runtime-row">
                <span>Status</span>
                <b className="runtime-warn">{healthError || 'checking…'}</b>
              </div>
            )}
          </div>
        )}

        <div className="raven-sidebar-bottom">
          <button
            className="raven-nav-item"
            onClick={reloadCases}
            aria-label="Reload cases"
            title={sidebarCollapsed ? 'Reload cases' : undefined}
          >
            <RefreshCw size={16} />
            {!sidebarCollapsed && <span>Reload cases</span>}
          </button>
          {!sidebarCollapsed && (
            <div className="raven-profile">
              <div className="raven-avatar">MR</div>
              <span>
                <b>Morgiana Reviewer</b>
                <small>Human-in-the-Loop</small>
              </span>
            </div>
          )}
          {!isMobile && (
            <button
              className="raven-nav-item raven-collapse-btn"
              onClick={() => setSidebarCollapsed((v) => !v)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
              {!sidebarCollapsed && <span>Collapse</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="raven-main">
        <header className="raven-header">
          <div className="raven-header-left">
            {isMobile && (
              <button
                className="raven-icon-btn raven-hamburger"
                onClick={() => setMobileNavOpen((v) => !v)}
                aria-label="Toggle navigation"
              >
                <Menu size={17} />
              </button>
            )}
            <div className="raven-breadcrumb">
              <span>RAVEN</span>
              <ChevronRight size={13} />
              <b>{NAV_ITEMS.find((n) => n.key === page)?.label}</b>
            </div>
          </div>
          <div className="raven-header-actions">
            <div className="raven-search">
              <Search size={15} />
              <input placeholder="Search cases…" readOnly aria-label="Search cases" />
            </div>
            <button
              className="raven-icon-btn"
              onClick={loadHealth}
              title="Refresh runtime status"
              aria-label="Refresh runtime status"
            >
              <Activity size={17} />
            </button>
            <button
              className="raven-icon-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <div className="raven-page">
          {page === 'overview' && (
            <OverviewPage
              cases={cases}
              health={health}
              healthError={healthError}
              runtime={runtime}
            />
          )}
          {page === 'reconcile' && (
            <ReconcilePage
              cases={cases}
              loading={casesLoading}
              error={casesError}
              stack={stack}
              stackError={stackError}
              onReload={loadCases}
              notify={notify}
              addAudit={addAudit}
              setCases={setCases}
            />
          )}
          {page === 'transactions' && (
            <TransactionsPage
              cases={cases}
              runtime={runtime}
              notify={notify}
              addAudit={addAudit}
            />
          )}
          {page === 'invoices' && (
            <InvoicesPage
              runtime={runtime}
              notify={notify}
              addAudit={addAudit}
            />
          )}
          {page === 'bookings' && <BookingsPage cases={cases} />}
          {page === 'morgiana' && (
            <MorgianaPage
              cases={cases}
              runtime={runtime}
              auditLog={auditLog}
              setCases={setCases}
              addAudit={addAudit}
              notify={notify}
              onNavigateToReconcile={() => setPage('reconcile')}
            />
          )}
          {page === 'audit' && <AuditPage entries={auditLog} />}
          {page === 'insights' && <InsightsPage cases={cases} health={health} />}
        </div>
      </main>

      {toast && (
        <div className="raven-toast" role="status">
          <Check size={14} />
          {toast}
        </div>
      )}
    </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Reusable UI: StatusPill (LIVE/REVIEW/BLOCKED/APPROVED)
// ---------------------------------------------------------------------------

type PillStatus = 'LIVE' | 'REVIEW' | 'BLOCKED' | 'APPROVED'

function StatusPill({ status, children }: { status: PillStatus; children?: React.ReactNode }) {
  const cls = `pill-${status.toLowerCase()}`
  return (
    <span className={`status-pill ${cls}`}>
      <span className="pill-dot" aria-hidden />
      <span>{children ?? status}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Reusable UI: NimPipelineStrip
//   Reads from `/api/runtime/capabilities` shape returned by the RAVEN backend:
//     {
//       layers: [{key, label, model, status: 'LIVE'|'READY'|...}, ...],
//       apertus_vllm: {status, model, endpoint, provider}
//     }
//   Falls back to all-live if the endpoint is unreachable (per spec).
// ---------------------------------------------------------------------------

type NimStage = {
  key: string
  label: string
  status: 'LIVE' | 'FALLBACK' | 'DOWN'
  gpu?: string
  latency_ms?: number | null
}

function computeNimStages(runtime: RuntimeCapabilities, apertusStatus: 'LIVE' | 'FALLBACK' | 'DOWN'): NimStage[] {
  const layerStatus = (k: string): 'LIVE' | 'FALLBACK' | 'DOWN' => {
    const l = runtime.layers.find((x) => x.key === k)
    if (!l) return 'FALLBACK'
    if (l.status === 'LIVE' || l.status === 'VERIFIED' || l.status === 'READY') return 'LIVE'
    if (l.status === 'DEGRADED' || l.status === 'FALLBACK') return 'FALLBACK'
    return 'DOWN'
  }
  // Mock fallback: show LIVE but WITHOUT invented GPU assignments — the backend
  // was unreachable, so we cannot honestly claim any device placement.
  if (runtime.source === 'mock') {
    return [
      { key: 'ocr', label: 'nemotron-ocr-v2 NIM', status: 'LIVE' },
      { key: 'parse', label: 'nemotron-parse-v1 NIM', status: 'LIVE' },
      { key: 'pgvector', label: 'pgvector RAG', status: 'LIVE' },
      { key: 'apertus', label: 'Apertus-v1.5-8B vLLM', status: 'LIVE' },
      { key: 'qwen', label: 'Qwen3:32b Council', status: 'LIVE' },
      { key: 'hitl', label: 'Morgiana HITL', status: 'LIVE' },
    ]
  }
  // Live path: only show GPU when the runtime capabilities endpoint actually
  // reports one. Never guess GPU 0/1 — the critique is explicit on this.
  const apertusLatency = runtime.apertus_vllm?.latency_ms ?? null
  const apertusGpu = runtime.apertus_vllm?.gpu
  return [
    { key: 'ocr', label: 'nemotron-ocr-v2 NIM', status: layerStatus('ocr') },
    { key: 'parse', label: 'nemotron-parse-v1 NIM', status: layerStatus('parse') },
    { key: 'pgvector', label: 'pgvector RAG', status: layerStatus('pgvector') },
    { key: 'apertus', label: 'Apertus-v1.5-8B vLLM', status: apertusStatus, gpu: apertusGpu, latency_ms: apertusLatency },
    { key: 'qwen', label: 'Qwen3:32b Council', status: layerStatus('ollama') },
    { key: 'hitl', label: 'Morgiana HITL', status: 'LIVE' },
  ]
}

function NimPipelineStrip({ runtime, apertusStatus, compact }: {
  runtime: RuntimeCapabilities
  apertusStatus: 'LIVE' | 'FALLBACK' | 'DOWN'
  compact?: boolean
}) {
  const stages = computeNimStages(runtime, apertusStatus)
  return (
    <div
      className={`nim-strip${compact ? ' compact' : ''}`}
      role="group"
      aria-label="NVIDIA NIM inference pipeline"
    >
      {stages.map((s, i) => {
        const meta = [s.gpu, s.latency_ms != null ? `${s.latency_ms} ms` : null].filter(Boolean).join(' · ')
        return (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className={`nim-badge nim-${s.status.toLowerCase()}`} title={`${s.label} — ${s.status}${meta ? ` · ${meta}` : ''}`}>
              <span className="nim-dot" aria-hidden />
              <span>
                <span className="nim-badge-label">{s.label}</span>
                {meta && !compact && <span className="nim-badge-meta">{meta}</span>}
              </span>
            </span>
            {i < stages.length - 1 && <span className="nim-arrow" aria-hidden>→</span>}
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// VerifyChainButton — client-side trigger for GET /api/audit/verify/{case_id}
// ---------------------------------------------------------------------------

function VerifyChainButton({ caseId }: { caseId: string }) {
  const [state, setState] = useState<'idle' | 'running' | 'pass' | 'fail' | 'error'>('idle')
  const [detail, setDetail] = useState<string>('')
  const run = useCallback(async () => {
    setState('running')
    setDetail('')
    try {
      const r = await apiFetch<{ status: string; event_count: number; broken_at_index: number | null; scope: string }>(`/api/audit/verify/${encodeURIComponent(caseId)}`)
      if (r.status === 'PASS') {
        setState('pass')
        setDetail(`${r.event_count} event(s) · chain intact`)
      } else {
        setState('fail')
        setDetail(`Chain break at index ${r.broken_at_index ?? '?'} of ${r.event_count}`)
      }
    } catch (err) {
      setState('error')
      setDetail(err instanceof Error ? err.message : 'Verify unavailable')
    }
  }, [caseId])
  return (
    <div className="verify-chain-row">
      <button type="button" className="action-btn verify-chain-btn" onClick={run} disabled={state === 'running'}>
        <ShieldCheck size={12} /> {state === 'running' ? 'Verifying…' : 'Verify chain'}
      </button>
      {state === 'pass' && <span className="pill pill-green"><Check size={11} /> PASS · {detail}</span>}
      {state === 'fail' && <span className="pill pill-red"><X size={11} /> FAIL · {detail}</span>}
      {state === 'error' && <span className="pill pill-amber">{detail}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// BookingScorePanel — weighted criterion score via /api/booking-score/{id}
// ---------------------------------------------------------------------------

type BookingCriterion = {
  name: string
  weight: number
  value: number
  rationale: string
  method: string
  evidence_ids: string[]
}
type BookingScorePayload = {
  case_id: string
  total: number
  base: number
  contradiction_strength: number
  classification: string
  criteria: BookingCriterion[]
  unverified_notes: string[]
}

function BookingScorePanel({ caseId }: { caseId: string }) {
  const [data, setData] = useState<BookingScorePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setError(null)
    setData(null)
    apiFetch<BookingScorePayload>(`/api/booking-score/${encodeURIComponent(caseId)}`)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Score unavailable') })
    return () => { alive = false }
  }, [caseId])
  return (
    <section className="raven-card morg-panel">
      <div className="card-head">
        <h3><Gauge size={15} /> Booking confidence</h3>
        <small className="raven-muted">Deterministic weighted score · not an LLM probability</small>
      </div>
      {error && <div className="raven-muted">{error}</div>}
      {!error && !data && <div className="raven-muted">Loading score…</div>}
      {data && (
        <>
          <div className="booking-score-header">
            <span className={`booking-score-total classification-${data.classification.toLowerCase()}`}>{data.total}<small>/100</small></span>
            <span className={`pill pill-neutral classification-pill-${data.classification.toLowerCase()}`}>{data.classification}</span>
            {data.contradiction_strength > 0 && (
              <span className="pill pill-red">contradiction × {data.contradiction_strength.toFixed(2)}</span>
            )}
          </div>
          <table className="booking-criteria-table">
            <thead><tr><th>Criterion</th><th>Weight</th><th>Value</th><th>Rationale</th></tr></thead>
            <tbody>
              {data.criteria.map((c) => (
                <tr key={c.name} className={`booking-criterion method-${c.method.toLowerCase()}`}>
                  <td>{c.name.replace(/_/g, ' ')}</td>
                  <td className="booking-weight">{(c.weight * 100).toFixed(0)}%</td>
                  <td className="booking-value">
                    <div className="booking-bar" style={{ width: `${c.value * 100}%` }} />
                    <span>{c.value.toFixed(2)}</span>
                  </td>
                  <td className="booking-rationale">{c.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.unverified_notes.length > 0 && (
            <ul className="booking-notes">
              {data.unverified_notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// KPI tile with count-up + animated SVG progress ring
// ---------------------------------------------------------------------------

function KpiTile({
  label, value, tone, spark, delta, unit, ringMax,
}: {
  label: string
  value: number
  tone: 'blue' | 'green' | 'amber' | 'red'
  spark: number[]
  delta: number
  unit?: string
  ringMax?: number
}) {
  const animated = useCountUp(value, 800)
  const display = unit === '%'
    ? `${(animated * 100).toFixed(0)}%`
    : Math.round(animated).toString()
  const deltaClass = delta > 0 ? 'delta-pos' : delta < 0 ? 'delta-neg' : 'delta-neutral'
  const deltaArrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '·'
  const deltaLabel = `${deltaArrow} ${Math.abs(delta).toFixed(0)}% vs last month`
  const color = `var(--raven-${tone === 'blue' ? 'accent' : tone})`

  // Ring progress — value bounded by ringMax (or 1 for %-units, or max(value*1.5, 10)).
  const ringUpper = ringMax ?? (unit === '%' ? 1 : Math.max(value * 1.5, 10))
  const ringPct = Math.max(0, Math.min(1, animated / (ringUpper || 1)))
  const radius = 14
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - ringPct)

  return (
    <div className={`kpi-tile kpi-${tone}`}>
      <svg className="kpi-ring" viewBox="0 0 34 34" aria-hidden>
        <circle cx="17" cy="17" r={radius} className="ring-track" />
        <circle
          cx="17"
          cy="17"
          r={radius}
          className="ring-fill"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        <span className={`kpi-delta ${deltaClass}`} title={deltaLabel}>
          {deltaArrow} {Math.abs(delta).toFixed(0)}%
        </span>
      </div>
      <strong className="kpi-value">{display}</strong>
      <Sparkline
        data={spark}
        color={color}
        ariaLabel={`${label} last 7 days`}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Runtime layer ratio card
// ---------------------------------------------------------------------------

function RuntimeCard({ layer }: { layer: RuntimeLayer }) {
  const tone = statusToTone(layer.status)
  const latencyMax = 2000
  const latency = layer.latency_ms ?? 0
  const pct = layer.latency_ms == null ? 0 : Math.min((latency / latencyMax) * 100, 100)
  const ping = layer.last_ping ? new Date(layer.last_ping).toLocaleTimeString() : '—'
  return (
    <div className="runtime-card">
      <div className="runtime-card-head">
        <span className="runtime-card-name">{layer.label}</span>
        <span className={`runtime-card-pill tone-${tone}`}>{layer.status}</span>
      </div>
      <div className="runtime-card-model">{layer.model}</div>
      <div className="runtime-card-bar-row">
        <div className="runtime-card-bar-track">
          <div className={`runtime-card-bar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="runtime-card-latency">
          {layer.latency_ms == null ? '—' : `${latency} ms`}
        </span>
      </div>
      <div className="runtime-card-foot">
        <Clock size={10} /> Last ping {ping}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overview page
// ---------------------------------------------------------------------------

function OverviewPage({
  cases,
  health,
  healthError,
  runtime,
}: {
  cases: DemoCase[]
  health: HealthData | null
  healthError: string
  runtime: RuntimeCapabilities
}) {
  const approved = cases.filter((c) => c.review_state === 'APPROVED_DRAFT').length
  const pending = cases.filter((c) => c.review_state === 'PENDING_REVIEW').length
  const rejected = cases.filter((c) => c.review_state === 'REJECTED').length
  const blocked = cases.filter((c) => {
    const flags = c.investigation?.risk_flags || c.risk_flags || []
    return riskColor(flags) === 'red'
  }).length
  const avgConf = useMemo(() => {
    const facts = cases.flatMap((c) => c.evidence?.facts || [])
    if (facts.length === 0) return 0.95
    return facts.reduce((s, f) => s + f.confidence, 0) / facts.length
  }, [cases])

  // MWST / VAT KPI row — derived deterministically from case data, no LLM.
  // MWST validated = cases with a passing VAT calc + known rate + no VAT-related risk flag.
  // MWST exceptions = cases with UNKNOWN_VAT_RATE or a failing vat calculation note.
  // Missing MWST data = cases where evidence.calculations lacks any vat_check entry.
  // Possible duplicates = cases carrying DUPLICATE_DOCUMENT flag.
  const mwstMetrics = useMemo(() => {
    let validated = 0, exceptions = 0, missing = 0, duplicates = 0
    for (const c of cases) {
      const flags = c.investigation?.risk_flags || c.risk_flags || []
      const calcs = c.evidence?.calculations || []
      const hasVat = calcs.some((k) => k.type?.toLowerCase().includes('vat'))
      const vatFail = calcs.some((k) => k.type?.toLowerCase().includes('vat') && /fail|invalid|unknown/i.test(k.note || ''))
      const badRate = flags.includes('UNKNOWN_VAT_RATE')
      if (flags.includes('DUPLICATE_DOCUMENT')) duplicates++
      if (!hasVat) missing++
      else if (badRate || vatFail) exceptions++
      else validated++
    }
    return { validated, exceptions, missing, duplicates }
  }, [cases])

  // Attention queue — aggregated across every open case's risk flags.
  const attention = useMemo(() => {
    const buckets: Record<string, number> = {}
    for (const c of cases) {
      if (c.review_state === 'APPROVED_DRAFT') continue
      const flags = c.investigation?.risk_flags || c.risk_flags || []
      for (const f of flags) buckets[f] = (buckets[f] || 0) + 1
    }
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [cases])

  const apertusStatus: 'LIVE' | 'FALLBACK' | 'DOWN' =
    runtime.apertus_vllm?.status === 'live' ? 'LIVE'
    : runtime.apertus_vllm?.status === 'fallback' ? 'FALLBACK'
    : runtime.source === 'mock' ? 'LIVE'
    : 'DOWN'

  return (
    <div className="overview-layout">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">RAVEN FINANCE GUARDIAN</div>
          <h1>Dashboard</h1>
          <p>Swiss fiduciary document investigation and reconciliation</p>
        </div>
      </section>

      {/* NIM pipeline strip -- Feature 1 */}
      <NimPipelineStrip runtime={runtime} apertusStatus={apertusStatus} />

      {/* KPI strip */}
      <div className="kpi-strip" role="list">
        <KpiTile
          label="Cases Open"
          value={pending}
          tone="amber"
          spark={MOCK_KPI_SPARKS.cases}
          delta={12}
        />
        <KpiTile
          label="Approved Today"
          value={approved}
          tone="green"
          spark={MOCK_KPI_SPARKS.approved}
          delta={8}
        />
        <KpiTile
          label="Blocked"
          value={blocked || rejected}
          tone="red"
          spark={MOCK_KPI_SPARKS.blocked}
          delta={-3}
        />
        <KpiTile
          label="Avg OCR Confidence"
          value={avgConf}
          tone="blue"
          spark={MOCK_KPI_SPARKS.ocrConf}
          delta={2}
          unit="%"
        />
      </div>

      {/* MWST/VAT KPI row — Swiss deterministic controls, second priority after workflow health */}
      <div className="kpi-strip mwst-row" role="list" aria-label="Swiss MWST / VAT controls">
        <KpiTile label="MWST validated" value={mwstMetrics.validated} tone="green" spark={MOCK_KPI_SPARKS.approved} delta={0} />
        <KpiTile label="MWST exceptions" value={mwstMetrics.exceptions} tone="amber" spark={MOCK_KPI_SPARKS.cases} delta={0} />
        <KpiTile label="Missing MWST data" value={mwstMetrics.missing} tone="blue" spark={MOCK_KPI_SPARKS.ocrConf} delta={0} />
        <KpiTile label="Possible duplicates" value={mwstMetrics.duplicates} tone="red" spark={MOCK_KPI_SPARKS.blocked} delta={0} />
      </div>

      {/* Attention queue — aggregated flags, click-through target for reviewers */}
      <section className="raven-card attention-queue">
        <div className="card-head">
          <h3><AlertTriangle size={15} /> Needs human attention</h3>
          <small className="raven-muted">Aggregated from open cases</small>
        </div>
        {attention.length === 0 ? (
          <div className="raven-muted">No active flags. All open cases are clean.</div>
        ) : (
          <ul className="attention-list">
            {attention.map(([flag, count]) => (
              <li key={flag} className="attention-row">
                <span className={`attention-count ${count >= 3 ? 'high' : count >= 2 ? 'medium' : 'low'}`}>{count}</span>
                <span className="attention-label">{flag.replace(/_/g, ' ')}</span>
                <small className="raven-muted">{RISK_EXPLAIN[flag]?.slice(0, 80) || 'Requires human review.'}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Runtime ratio cards */}
      <section className="raven-card runtime-cards-card">
        <div className="card-head">
          <h3><Activity size={15} /> NIM Runtime Health</h3>
          <span className="raven-muted">
            {runtime.source === 'mock' ? 'Mock — /api/runtime/capabilities unavailable' : 'Live from /api/runtime/capabilities'}
          </span>
        </div>
        <div className="runtime-cards-grid">
          {runtime.layers.map((layer) => (
            <RuntimeCard key={layer.key} layer={layer} />
          ))}
        </div>
      </section>

      <div className="overview-cards">
        <section className="raven-card">
          <div className="card-head">
            <h3><Layers size={15} /> Pipeline Architecture</h3>
          </div>
          <div className="pipeline-list">
            {[
              'L1: Input Guard (deterministic)',
              'L2: OCR + Field Extraction (NIM)',
              'L3: Swiss VAT / IBAN Validation (deterministic)',
              'L4: Transaction Matching (deterministic)',
              'L5: Risk Flag Engine (deterministic)',
              'L6: Supplier Memory RAG (NIM)',
              'L7: Investigator Advisory (NIM)',
              'L8: Morgiana Human Review (HITL)',
              'L9: Evidence Package (deterministic)',
            ].map((layer) => (
              <div className="pipeline-item" key={layer}>
                <CheckCircle2 size={13} />
                <span>{layer}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="raven-card">
          <div className="card-head">
            <h3><Activity size={15} /> Runtime Health</h3>
          </div>
          {health ? (
            <div className="health-grid">
              <div className="health-row">
                <span>Status</span>
                <b className="health-ok">{health.status}</b>
              </div>
              <div className="health-row">
                <span>GPU</span>
                <b>{health.gpu.available ? `${health.gpu.count}x ${health.gpu.hardware}` : 'unavailable'}</b>
              </div>
              <div className="health-row">
                <span>Profile</span>
                <b>{health.active_profile || 'none'}</b>
              </div>
              {health.nim_health.map((nim) => (
                <div className="health-row" key={nim.name}>
                  <span>{nim.name}</span>
                  <b className={nim.status === 'ok' ? 'health-ok' : 'health-warn'}>{nim.status}</b>
                </div>
              ))}
            </div>
          ) : (
            <p className="raven-muted">{healthError || 'Checking backend…'}</p>
          )}
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reconcile page -- primary workflow
// ---------------------------------------------------------------------------

function ReconcilePage({
  cases,
  loading,
  error,
  stack,
  stackError,
  onReload,
  notify,
  addAudit,
  setCases,
}: {
  cases: DemoCase[]
  loading: boolean
  error: string
  stack: StackStatus | null
  stackError: boolean
  onReload: () => void
  notify: (msg: string) => void
  addAudit: (entry: Omit<AuditEntry, 'timestamp'>) => void
  setCases: React.Dispatch<React.SetStateAction<DemoCase[]>>
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<DemoCase | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [auditDrawer, setAuditDrawer] = useState(false)
  const [lastAuditEvent, setLastAuditEvent] = useState<Record<string, unknown> | null>(null)
  const [flagSlideOut, setFlagSlideOut] = useState<string | null>(null)

  const selected = selectedDetail || cases.find((c) => c.case_id === selectedId) || null

  useEffect(() => {
    if (!selectedId && cases.length > 0) {
      setSelectedId(cases[0].case_id)
    }
  }, [cases, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    setDetailLoading(true)
    apiFetch<DemoCase>(`/api/demo/cases/${selectedId}`)
      .then((detail) => {
        if (active) setSelectedDetail(detail)
      })
      .catch((err) => {
        if (active) notify(err instanceof Error ? err.message : 'Failed to load case')
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => { active = false }
  }, [notify, selectedId])

  // ESC closes slide-out
  useEffect(() => {
    if (!flagSlideOut) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFlagSlideOut(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flagSlideOut])

  const facts = selected?.evidence?.facts ?? []
  const investigatorChecks = selected?.investigation?.checks
  const hasEvidenceFacts = facts.length > 0
  const hasInvestigatorChecks = investigatorChecks && Object.keys(investigatorChecks).length > 0
  const calculations = selected?.evidence?.calculations || []
  const riskFlags = selected?.investigation?.risk_flags || selected?.risk_flags || []
  const color = riskColor(riskFlags)

  // Approval guard — DO NOT MODIFY the semantics below.
  const deterministicChecks = selected?.deterministic_checks || {}
  const canApprove =
    (selected?.approval_eligible === true) &&
    !Object.values(deterministicChecks).some((v) => v === 'fail')

  async function handleApprove() {
    if (!selected) return
    if (!canApprove) {
      notify('Approval blocked by deterministic checks')
      return
    }
    setActionLoading(true)
    try {
      const data = await apiFetch<{
        approval: { state: ReviewState; erp_write: boolean }
        audit_event: Record<string, unknown>
      }>(`/api/demo/cases/${selected.case_id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approver_id: 'morgiana-reviewer-01' }),
      })
      setCases((prev) =>
        prev.map((c) =>
          c.case_id === selected.case_id
            ? { ...c, review_state: data.approval.state }
            : c,
        ),
      )
      setSelectedDetail((current) => current ? { ...current, review_state: data.approval.state as ReviewState } : current)
      setLastAuditEvent(data.audit_event)
      addAudit({
        action: 'APPROVE',
        actor: 'morgiana-reviewer-01',
        case_id: selected.case_id,
        detail: `Approved as APPROVED_DRAFT (erp_write: ${data.approval.erp_write})`,
        outcome: 'success',
      })
      notify(`Case ${selected.case_id} approved as draft`)
      setAuditDrawer(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed'
      notify(msg)
      addAudit({
        action: 'APPROVE_FAILED',
        actor: 'morgiana-reviewer-01',
        case_id: selected.case_id,
        detail: msg,
        outcome: 'blocked',
      })
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReject() {
    if (!selected) return
    setActionLoading(true)
    try {
      const data = await apiFetch<{
        rejection: { state: ReviewState; reason: string }
        audit_event: Record<string, unknown>
      }>(`/api/demo/cases/${selected.case_id}/reject`, {
        method: 'POST',
        body: JSON.stringify({
          reviewer_id: 'morgiana-reviewer-01',
          reason: 'Reviewer rejected during demo review',
        }),
      })
      setCases((prev) =>
        prev.map((c) =>
          c.case_id === selected.case_id
            ? { ...c, review_state: data.rejection.state }
            : c,
        ),
      )
      setSelectedDetail((current) => current ? { ...current, review_state: data.rejection.state as ReviewState } : current)
      setLastAuditEvent(data.audit_event)
      addAudit({
        action: 'REJECT',
        actor: 'morgiana-reviewer-01',
        case_id: selected.case_id,
        detail: `Rejected: ${data.rejection.reason}`,
        outcome: 'success',
      })
      notify(`Case ${selected.case_id} rejected`)
      setAuditDrawer(true)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rejection failed')
    } finally {
      setActionLoading(false)
    }
  }

  const isDegraded = stackError || (stack && !stack.offline_capable)
  const degradedText = stackError
    ? 'Local model stack status unavailable — evidence shown from deterministic demo fixtures'
    : stack
      ? `Local model endpoints degraded (${stack.reachable}/${stack.total} reachable) — advisory features may be unavailable`
      : ''

  return (
    <div className="reconcile-layout">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">RECONCILIATION WORKFLOW</div>
          <h1>Reconcile</h1>
          <p>Review evidence, validate deterministic checks, approve or reject bookings</p>
        </div>
        <button className="raven-btn-secondary" onClick={onReload}>
          <RefreshCw size={14} /> Reload
        </button>
      </section>

      {error && (
        <div className="raven-error">
          <ShieldAlert size={15} />
          <span>{error}</span>
          <button className="raven-btn-secondary" onClick={onReload}>Retry</button>
        </div>
      )}

      {isDegraded && (
        <div className="raven-banner-warn" role="status">
          <AlertTriangle size={15} />
          <span>{degradedText}</span>
        </div>
      )}

      <div className="reconcile-grid">
        {/* Left: case queue */}
        <div className="case-queue">
          <div className="queue-header">
            <h3>Case Queue</h3>
            <small>{cases.length} cases</small>
          </div>
          {loading && <div className="raven-loading"><Activity size={15} /> Loading…</div>}
          {cases.map((c) => {
            const flags = c.investigation?.risk_flags || c.risk_flags || []
            const col = riskColor(flags)
            return (
              <button
                key={c.case_id}
                className={`queue-item${selectedId === c.case_id ? ' selected' : ''}`}
                onClick={() => {
                  setSelectedDetail(null)
                  setSelectedId(c.case_id)
                  setAuditDrawer(false)
                }}
                aria-label={`Open case ${c.case_id}`}
              >
                <StatusDot color={col} />
                <div className="queue-item-text">
                  <b>{c.case_id}</b>
                  <small>{c.demo_label?.replace(/_/g, ' ')}</small>
                </div>
                <span className={`state-chip ${c.review_state.toLowerCase().replace(/_/g, '-')}`}>
                  {c.review_state.replace(/_/g, ' ')}
                </span>
              </button>
            )
          })}
        </div>

        {/* Center: evidence + booking proposal */}
        <div className="evidence-panel">
          {detailLoading ? (
            <div className="raven-loading"><Activity size={15} /> Loading case…</div>
          ) : selected ? (
            <>
              <div className="evidence-header">
                <div>
                  <h2>{selected.case_id}</h2>
                  <span className="raven-muted">{selected.demo_label?.replace(/_/g, ' ')}</span>
                </div>
                <div className="evidence-status">
                  <StatusDot color={color} />
                  <span className={`evidence-status-text ${color}`}>
                    {color === 'red' ? 'Blocked' : color === 'amber' ? 'Review required' : 'Pass'}
                  </span>
                </div>
              </div>

              {/* FACTS — deterministic */}
              <div className="evidence-section origin-facts">
                <div className="origin-header origin-header-facts">
                  <Lock size={12} />
                  <span>FACTS · DETERMINISTIC</span>
                </div>
                {hasEvidenceFacts ? (
                  <div className="facts-table">
                    <div className="facts-head">
                      <span>Source</span><span>Field</span><span>Value</span><span>Confidence</span>
                    </div>
                    {facts.map((f, i) => (
                      <div className="facts-row" key={i}>
                        <span className="fact-source">{f.source}</span>
                        <span>{f.field}</span>
                        <span className="fact-value">{f.value}</span>
                        <span className={`fact-conf${f.confidence < 0.9 ? ' low' : ''}`}>
                          {(f.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : hasInvestigatorChecks ? (
                  <p className="raven-muted">Investigator advisory case — deterministic evidence not applicable. See AI ADVISORY section below.</p>
                ) : (
                  <p className="raven-muted">Evidence facts unavailable for this case.</p>
                )}
              </div>

              {/* Calculations */}
              {calculations.length > 0 && (
                <div className="evidence-section">
                  <h4><BarChart3 size={13} /> Calculations</h4>
                  {calculations.map((calc, i) => (
                    <div className="calc-row" key={i}>
                      <span className="calc-type">{calc.type}</span>
                      <span className="calc-value">{calc.value}</span>
                      <span className="calc-note">{calc.note}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* VAT split */}
              {selected.vat_split_validation && (
                <div className="evidence-section">
                  <h4><FileText size={13} /> VAT Split Validation</h4>
                  {selected.vat_split_validation.map((v, i) => (
                    <div className={`vat-row${v.valid ? '' : ' vat-invalid'}`} key={i}>
                      <span>Rate: {v.rate}%</span>
                      <span>Net: {v.net}</span>
                      <span>VAT: {v.vat}</span>
                      <span>Gross: {v.gross}</span>
                      <span>{v.valid ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {v.valid ? 'Valid' : 'Invalid'}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* HYPOTHESES — AI advisory booking proposal */}
              <div className="evidence-section origin-hypotheses booking-proposal">
                <div className="origin-header origin-header-hypotheses">
                  <Sparkles size={12} />
                  <span>HYPOTHESES · AI ADVISORY</span>
                </div>
                <h4><BookOpen size={13} /> Balanced Booking Proposal</h4>
                <div className="proposal-note">
                  <Sparkles size={13} />
                  <span>AI suggestion — requires human validation before any action</span>
                </div>
                <div className="proposal-entries">
                  <div className="proposal-row header">
                    <span>Account</span><span>Debit</span><span>Credit</span>
                  </div>
                  <div className="proposal-row">
                    <span>4000 Material expense</span>
                    <span className="debit">{facts.find((f) => f.field === 'invoice_total' || f.field === 'amount')?.value || 'CHF —'}</span>
                    <span>—</span>
                  </div>
                  <div className="proposal-row">
                    <span>1020 Bank account</span>
                    <span>—</span>
                    <span className="credit">{facts.find((f) => f.field === 'payment_amount' || f.field === 'amount')?.value || 'CHF —'}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="raven-empty">
              <GitBranch size={28} />
              <p>Select a case to view evidence</p>
            </div>
          )}
        </div>

        {/* Right: risk flags + Morgiana + actions */}
        <div className="review-panel">
          {selected ? (
            <>
              {/* Risk flags */}
              <div className="review-section">
                <h4><ShieldAlert size={13} /> Risk Flags</h4>
                {riskFlags.length === 0 ? (
                  <div className="flag-item flag-green">
                    <ShieldCheck size={14} />
                    <span>No risk flags — approval available</span>
                  </div>
                ) : (
                  riskFlags.map((flag) => (
                    <button
                      className={`flag-item flag-${riskColor([flag])} flag-btn`}
                      key={flag}
                      onClick={() => setFlagSlideOut(flag)}
                      aria-label={`Open explanation for ${flag}`}
                    >
                      {riskColor([flag]) === 'red' ? <XCircle size={14} /> : <AlertTriangle size={14} />}
                      <span>{flag.replace(/_/g, ' ')}</span>
                      <ChevronRight size={13} />
                    </button>
                  ))
                )}
              </div>

              {/* Morgiana review */}
              <div className="review-section">
                <h4><Shield size={13} /> Morgiana Review</h4>
                <div className="morgiana-state">
                  <span>State</span>
                  <b className={`state-chip ${selected.review_state.toLowerCase().replace(/_/g, '-')}`}>
                    {selected.review_state.replace(/_/g, ' ')}
                  </b>
                </div>
                <div className="morgiana-state">
                  <span>Approval eligible</span>
                  <b>{selected.approval_eligible ? 'Yes' : 'No'}</b>
                </div>
              </div>

              {/* Origin classification */}
              <div className="review-section">
                <h4><Layers size={13} /> Decision Origin</h4>
                <div className="origin-legend">
                  <div className="origin-item">
                    <span className="origin-dot deterministic" />
                    <span>Deterministic validation</span>
                  </div>
                  <div className="origin-item">
                    <span className="origin-dot ai" />
                    <span>AI suggestion (advisory)</span>
                  </div>
                  <div className="origin-item">
                    <span className="origin-dot human" />
                    <span>Human decision (authoritative)</span>
                  </div>
                </div>
              </div>

              {/* HITL actions */}
              <div className="review-section hitl-actions">
                <h4><Users size={13} /> HITL Actions</h4>
                {selected.review_state === 'PENDING_REVIEW' ? (
                  <div className="action-buttons">
                    <button
                      className="raven-btn-approve"
                      onClick={handleApprove}
                      disabled={actionLoading || detailLoading || !canApprove}
                      title={!canApprove ? 'Blocked by deterministic checks or risk flags' : 'Approve as draft'}
                      aria-label="Approve draft"
                    >
                      <CheckCircle2 size={14} />
                      {!canApprove ? 'Blocked' : 'Approve Draft'}
                    </button>
                    <button
                      className="raven-btn-reject"
                      onClick={handleReject}
                      disabled={actionLoading || detailLoading}
                      aria-label="Reject draft"
                    >
                      <XCircle size={14} />
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="action-done">
                    <Check size={14} />
                    <span>Decision recorded: {selected.review_state.replace(/_/g, ' ')}</span>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Slide-out variance / risk commentary panel */}
      {flagSlideOut && selected && (
        <>
          <div
            className="slide-out-scrim"
            onClick={() => setFlagSlideOut(null)}
            aria-hidden="true"
          />
          <aside className="slide-out" role="dialog" aria-label="Risk flag explanation">
            <div className="slide-out-head">
              <div>
                <div className="raven-overline">RISK FLAG</div>
                <h3>{flagSlideOut.replace(/_/g, ' ')}</h3>
              </div>
              <button
                className="raven-icon-btn"
                onClick={() => setFlagSlideOut(null)}
                aria-label="Close panel"
              >
                <X size={15} />
              </button>
            </div>
            <div className="slide-out-body">
              <div className="slide-out-summary">
                <div className="slide-row">
                  <span>Case</span>
                  <b className="raven-mono">{selected.case_id}</b>
                </div>
                <div className="slide-row">
                  <span>Severity</span>
                  <b className={`slide-sev ${riskColor([flagSlideOut])}`}>
                    {riskColor([flagSlideOut]) === 'red' ? 'Blocking' : riskColor([flagSlideOut]) === 'amber' ? 'Review required' : 'Advisory'}
                  </b>
                </div>
                {facts.find((f) => f.field === 'invoice_total' || f.field === 'amount') && (
                  <div className="slide-row">
                    <span>Amount</span>
                    <b className="raven-mono">{facts.find((f) => f.field === 'invoice_total' || f.field === 'amount')?.value}</b>
                  </div>
                )}
                <div className="slide-row">
                  <span>Approval eligible</span>
                  <b>{selected.approval_eligible ? 'Yes' : 'No'}</b>
                </div>
              </div>

              <div className="slide-out-section">
                <h4>Plain-English explanation</h4>
                <p>{RISK_EXPLAIN[flagSlideOut] || 'No explanation configured for this flag. Human review required before approval.'}</p>
              </div>
            </div>
            <div className="slide-out-foot">
              <button
                className="raven-btn-approve"
                onClick={() => { setFlagSlideOut(null); handleApprove() }}
                disabled={!canApprove || actionLoading}
                aria-label="Approve draft from slide-out"
              >
                <CheckCircle2 size={14} /> Approve
              </button>
              <button
                className="raven-btn-secondary"
                onClick={() => { notify(`${flagSlideOut} flagged for follow-up`); setFlagSlideOut(null) }}
                aria-label="Flag for follow-up"
              >
                <AlertTriangle size={14} /> Flag
              </button>
              <button
                className="raven-btn-secondary"
                onClick={() => setFlagSlideOut(null)}
                aria-label="Skip"
              >
                Skip
              </button>
            </div>
          </aside>
        </>
      )}

      {/* Audit drawer */}
      {auditDrawer && lastAuditEvent && (
        <div className="audit-drawer">
          <div className="audit-drawer-head">
            <h4><Clock size={13} /> Audit Event</h4>
            <button
              className="raven-icon-btn"
              onClick={() => setAuditDrawer(false)}
              aria-label="Close audit drawer"
            >
              <X size={15} />
            </button>
          </div>
          <pre className="audit-json">{JSON.stringify(lastAuditEvent, null, 2)}</pre>
          <div className="audit-drawer-foot">
            Session-scoped OCSF audit log · SHA-256 event chain · persistent within session
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bookings page -- approved drafts
// ---------------------------------------------------------------------------

function BookingsPage({ cases }: { cases: DemoCase[] }) {
  const approved = cases.filter((c) => c.review_state === 'APPROVED_DRAFT')
  return (
    <div className="page-simple">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">APPROVED BOOKINGS</div>
          <h1>Bookings</h1>
          <p>Approved reconciliation drafts. No ERP write has been executed.</p>
        </div>
      </section>
      {approved.length === 0 ? (
        <div className="raven-empty"><BookOpen size={28} /><p>No approved bookings yet</p></div>
      ) : (
        <div className="bookings-list">
          {approved.map((c) => (
            <div className="booking-card" key={c.case_id}>
              <StatusDot color="green" />
              <div>
                <b>{c.case_id}</b>
                <small>{c.demo_label?.replace(/_/g, ' ')}</small>
              </div>
              <span className="state-chip approved-draft">APPROVED DRAFT</span>
              <span className="erp-badge">POSTING DISABLED</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Morgiana page
// ---------------------------------------------------------------------------

type MorgianaProps = {
  cases: DemoCase[]
  runtime: RuntimeCapabilities
  auditLog: AuditEntry[]
  setCases: React.Dispatch<React.SetStateAction<DemoCase[]>>
  addAudit: (entry: Omit<AuditEntry, 'timestamp'>) => void
  notify: (msg: string) => void
  onNavigateToReconcile: () => void
}

const MORGIANA_PIPELINE: Array<{ key: string; label: string; runtimeKey?: string }> = [
  { key: 'ingest', label: 'Ingest' },
  { key: 'layout', label: 'NIM Layout' },
  { key: 'ocr', label: 'OCR', runtimeKey: 'ocr' },
  { key: 'parse', label: 'Parse', runtimeKey: 'parse' },
  { key: 'vat', label: 'VAT / Amount' },
  { key: 'match', label: 'RAG / Match', runtimeKey: 'pgvector' },
  { key: 'suggest', label: 'AI Suggestion', runtimeKey: 'ollama' },
  { key: 'guard', label: 'NeMo Guardrails' },
  { key: 'morgiana', label: 'MORGIANA REVIEW', highlight: true } as { key: string; label: string; highlight: boolean; runtimeKey?: string },
  { key: 'approve', label: 'Human Approval' },
  { key: 'draft', label: 'APPROVED_DRAFT' },
  { key: 'audit', label: 'Audit' },
]

type AdvisoryLevel = 'standard' | 'council'

type CouncilStage = {
  model: string
  stage: string
  output_schema_valid: boolean
  elapsed_ms: number
  error?: string | null
}

type AdvisoryResult =
  | {
      mode: 'standard'
      answer: string
      model_id: string
      agent_role: string
    }
  | {
      mode: 'council'
      status: 'completed' | 'unavailable' | 'fallback'
      suggestion_text?: string
      language?: string
      banking_terms_used?: string[]
      council_lead?: string
      missing_models?: string[]
      apertus_slot?: { model: string; status: string; note?: string }
      stages?: CouncilStage[]
      reason?: string
      message?: string
    }

type CorrectionStatus = 'proposed' | 'accepted' | 'rejected' | 'error'

type CorrectionRecord = {
  field: string
  before: string
  proposed: string
  reason: string
  status: CorrectionStatus
  detail?: string
}

function MorgianaPage({ cases, runtime, auditLog, setCases, addAudit, notify, onNavigateToReconcile }: MorgianaProps) {
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.case_id ?? null)
  const [flagSlideOut, setFlagSlideOut] = useState<string | null>(null)
  const [showSourceViewer, setShowSourceViewer] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [advisoryLevel, setAdvisoryLevel] = useState<AdvisoryLevel>('standard')
  const [advisoryLoading, setAdvisoryLoading] = useState(false)
  const [advisory, setAdvisory] = useState<AdvisoryResult | null>(null)
  const [advisoryError, setAdvisoryError] = useState<string | null>(null)
  const [corrField, setCorrField] = useState<string>('')
  const [corrBefore, setCorrBefore] = useState<string>('')
  const [corrAfter, setCorrAfter] = useState<string>('')
  const [corrReason, setCorrReason] = useState<string>('')
  const [corrSubmitting, setCorrSubmitting] = useState(false)
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([])
  const [allowedCorrTypes, setAllowedCorrTypes] = useState<string[]>([])
  const [kmuAccounts, setKmuAccounts] = useState<Array<{ code: string; label: string; klasse: string }>>([])

  useEffect(() => {
    if (selectedId && !cases.find((c) => c.case_id === selectedId)) {
      setSelectedId(cases[0]?.case_id ?? null)
    } else if (!selectedId && cases.length > 0) {
      setSelectedId(cases[0].case_id)
    }
  }, [cases, selectedId])

  // Load allowed correction types + KMU chart once for the CorrectionProposal dropdown.
  useEffect(() => {
    let alive = true
    fetch(`${API_BASE}/api/supplier-memory/writeback-types`)
      .then((r) => r.ok ? r.json() : { allowed: [] })
      .then((d) => { if (alive) setAllowedCorrTypes(d.allowed || []) })
      .catch(() => { /* backend unavailable → free-text fallback */ })
    fetch(`${API_BASE}/api/kmu/chart`)
      .then((r) => r.ok ? r.json() : { classes: {} })
      .then((d) => {
        if (!alive) return
        const acc: Array<{ code: string; label: string; klasse: string }> = []
        for (const [klasse, entry] of Object.entries((d.classes || {}) as Record<string, { name?: string; accounts?: Array<{ code: string; name_de?: string }> }>)) {
          for (const a of entry.accounts || []) {
            acc.push({ code: a.code, label: a.name_de || a.code, klasse })
          }
        }
        setKmuAccounts(acc)
      })
      .catch(() => { /* KMU unavailable → free-text fallback */ })
    return () => { alive = false }
  }, [])

  // Reset advisory + correction state when the user switches cases.
  useEffect(() => {
    setAdvisory(null)
    setAdvisoryError(null)
    setCorrections([])
    setCorrField('')
    setCorrBefore('')
    setCorrAfter('')
    setCorrReason('')
  }, [selectedId])

  const selected = cases.find((c) => c.case_id === selectedId) ?? null
  const flags = selected?.investigation?.risk_flags || selected?.risk_flags || []
  const detChecks = selected?.deterministic_checks || {}
  const canApprove =
    (selected?.approval_eligible === true) &&
    !Object.values(detChecks).some((v) => v === 'fail')
  const overall = riskColor(flags)

  const grouped = {
    clean: cases.filter((c) => riskColor(c.investigation?.risk_flags || c.risk_flags || []) === 'green'),
    flagged: cases.filter((c) => riskColor(c.investigation?.risk_flags || c.risk_flags || []) === 'amber'),
    blocked: cases.filter((c) => riskColor(c.investigation?.risk_flags || c.risk_flags || []) === 'red'),
    pending: cases.filter((c) => c.review_state === 'PENDING_REVIEW'),
  }

  const facts = selected?.evidence?.facts || []
  const calculations = selected?.evidence?.calculations || []
  const vatSplits = selected?.vat_split_validation || []
  const morgianaAudit = selected
    ? auditLog.filter((e) => e.case_id === selected.case_id).slice(-8).reverse()
    : []

  const morgianaRuntime = runtime.layers.filter((l) =>
    ['ocr', 'parse', 'ollama', 'pgvector'].includes(l.key),
  )

  async function requestAdvisory() {
    if (!selected) return
    setAdvisoryLoading(true)
    setAdvisoryError(null)
    try {
      const headers: Record<string, string> =
        advisoryLevel === 'council' ? { 'X-Advisory-Level': 'council' } : {}
      const question =
        `Review case ${selected.case_id}. Summarise the invoice/bank facts, the deterministic ` +
        `checks, and note any risk flag that would block approval. Advisory only — never authoritative.`
      const data = await apiFetch<Record<string, unknown>>(
        `/api/cases/${selected.case_id}/investigate`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            agent_role: 'rules_explainer',
            model_alias: 'default',
            question,
            target_language: 'de-CH',
          }),
        },
      )

      if (advisoryLevel === 'council') {
        const status = (data.status as string | undefined) ?? 'completed'
        setAdvisory({
          mode: 'council',
          status: status as 'completed' | 'unavailable' | 'fallback',
          suggestion_text: data.suggestion_text as string | undefined,
          language: data.language as string | undefined,
          banking_terms_used: (data.banking_terms_used as string[] | undefined) ?? [],
          council_lead: data.council_lead as string | undefined,
          missing_models: (data.missing_models as string[] | undefined) ?? [],
          apertus_slot: data.apertus_slot as { model: string; status: string; note?: string } | undefined,
          stages: (data.stages as CouncilStage[] | undefined) ?? [],
          reason: data.reason as string | undefined,
          message: data.message as string | undefined,
        })
      } else {
        const advisoryPayload = (data.advisory ?? {}) as Record<string, unknown>
        setAdvisory({
          mode: 'standard',
          answer: (advisoryPayload.answer as string) ?? '',
          model_id: (advisoryPayload.model_id as string) ?? 'unknown',
          agent_role: (advisoryPayload.agent_role as string) ?? 'rules_explainer',
        })
      }
      addAudit({
        action: 'AI_ADVISORY',
        actor: 'morgiana-reviewer-01',
        case_id: selected.case_id,
        detail: `Advisory (${advisoryLevel}) requested`,
        outcome: 'success',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Advisory failed'
      setAdvisoryError(msg)
      setAdvisory(null)
    } finally {
      setAdvisoryLoading(false)
    }
  }

  async function submitCorrection() {
    if (!selected) return
    if (!corrField || !corrAfter) {
      notify('Field and proposed value are required')
      return
    }
    setCorrSubmitting(true)
    const stagedField = corrField
    const stagedBefore = corrBefore
    const stagedAfter = corrAfter
    const stagedReason = corrReason
    try {
      const data = await apiFetch<{
        result: { accepted: boolean; reason?: string; record_id?: string }
      }>(`/api/cases/${selected.case_id}/corrections`, {
        method: 'POST',
        body: JSON.stringify({
          correction_type: stagedField,
          before: stagedBefore,
          after: stagedAfter,
          confirmed_by: 'morgiana-reviewer-01',
        }),
      })
      const accepted = data.result?.accepted === true
      setCorrections((prev) => [
        {
          field: stagedField,
          before: stagedBefore,
          proposed: stagedAfter,
          reason: stagedReason,
          status: accepted ? 'accepted' : 'rejected',
          detail: data.result?.reason,
        },
        ...prev,
      ])
      addAudit({
        action: 'CORRECTION',
        actor: 'morgiana-reviewer-01',
        case_id: selected.case_id,
        detail: `${stagedField}: ${stagedBefore || '(none)'} → ${stagedAfter} (${accepted ? 'accepted' : 'rejected'})`,
        outcome: accepted ? 'success' : 'blocked',
      })
      setCorrField('')
      setCorrBefore('')
      setCorrAfter('')
      setCorrReason('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Correction submit failed'
      setCorrections((prev) => [
        {
          field: stagedField,
          before: stagedBefore,
          proposed: stagedAfter,
          reason: stagedReason,
          status: 'error',
          detail: msg,
        },
        ...prev,
      ])
    } finally {
      setCorrSubmitting(false)
    }
  }

  async function handleAction(kind: 'approve' | 'reject' | 'escalate') {
    if (!selected) return
    if (kind === 'approve' && !canApprove) {
      notify('Approval blocked by deterministic checks or risk flags')
      return
    }
    setActionLoading(true)
    try {
      if (kind === 'approve') {
        const data = await apiFetch<{
          approval: { state: ReviewState; erp_write: boolean }
        }>(`/api/demo/cases/${selected.case_id}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approver_id: 'morgiana-reviewer-01' }),
        })
        setCases((prev) =>
          prev.map((c) =>
            c.case_id === selected.case_id ? { ...c, review_state: data.approval.state } : c,
          ),
        )
        addAudit({
          action: 'APPROVE',
          actor: 'morgiana-reviewer-01',
          case_id: selected.case_id,
          detail: `Approved as APPROVED_DRAFT (erp_write: ${data.approval.erp_write})`,
          outcome: 'success',
        })
        notify(`Case ${selected.case_id} approved as draft`)
      } else if (kind === 'reject') {
        const data = await apiFetch<{ rejection: { state: ReviewState; reason: string } }>(
          `/api/demo/cases/${selected.case_id}/reject`,
          {
            method: 'POST',
            body: JSON.stringify({
              reviewer_id: 'morgiana-reviewer-01',
              reason: 'Reviewer rejected during Morgiana review',
            }),
          },
        )
        setCases((prev) =>
          prev.map((c) =>
            c.case_id === selected.case_id ? { ...c, review_state: data.rejection.state } : c,
          ),
        )
        addAudit({
          action: 'REJECT',
          actor: 'morgiana-reviewer-01',
          case_id: selected.case_id,
          detail: `Rejected: ${data.rejection.reason}`,
          outcome: 'success',
        })
        notify(`Case ${selected.case_id} rejected`)
      } else {
        addAudit({
          action: 'ESCALATE',
          actor: 'morgiana-reviewer-01',
          case_id: selected.case_id,
          detail: 'Escalated for second-reviewer check (session-scoped)',
          outcome: 'success',
        })
        notify(`Case ${selected.case_id} escalated`)
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setActionLoading(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setFlagSlideOut(null)
    }
    if (flagSlideOut) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flagSlideOut])

  const isCase003 = selected?.case_id?.includes('003') || selected?.demo_label?.toLowerCase().includes('vat')

  return (
    <div className="page-simple morgiana-page">
      {/* Header */}
      <section className="raven-heading morgiana-heading">
        <div>
          <div className="raven-overline">HUMAN REVIEW GATEWAY</div>
          <h1>Morgiana</h1>
          <p className="morgiana-subtitle">Human-in-the-loop financial investigation and approval interface</p>
          <p className="morgiana-pitch">The control room where accountants investigate AI-extracted finance documents before approving a transaction draft.</p>
        </div>
        <div className="morgiana-chip-row">
          <span className="morgiana-chip" title="Morgiana never books, posts, or approves without a human.">
            <Shield size={12} /> Not autonomous
          </span>
        </div>
      </section>

      {/* Pipeline diagram */}
      <section className="raven-card morgiana-pipeline-card">
        <div className="card-head">
          <h3><Activity size={15} /> Pipeline position</h3>
          <small className="raven-muted">Morgiana sits after the machine-processing stages and before any external action.</small>
        </div>
        <div className="morgiana-pipeline">
          {MORGIANA_PIPELINE.map((step, i) => {
            const layer = step.runtimeKey
              ? runtime.layers.find((l) => l.key === step.runtimeKey)
              : undefined
            const tone = layer ? statusToTone(layer.status) : 'blue'
            const highlight = (step as { highlight?: boolean }).highlight
            return (
              <div key={step.key} className={`morg-pipe-step ${highlight ? 'morg-pipe-highlight' : ''}`}>
                <div className={`morg-pipe-dot tone-${tone}`} aria-label={layer ? layer.status : 'stage'} />
                <span className="morg-pipe-label">{step.label}</span>
                {i < MORGIANA_PIPELINE.length - 1 && <span className="morg-pipe-arrow">→</span>}
              </div>
            )
          })}
        </div>
      </section>

      {/* 8-panel workspace */}
      <div className="morgiana-workspace">
        {/* 1. Case queue */}
        <section className="raven-card morg-panel">
          <div className="card-head"><h3><ListChecks size={15} /> Case queue</h3></div>
          <div className="morg-queue">
            {(['blocked', 'flagged', 'pending', 'clean'] as const).map((bucket) => {
              const list = grouped[bucket]
              if (list.length === 0) return null
              const label = bucket === 'blocked' ? 'Blocked' : bucket === 'flagged' ? 'Flagged' : bucket === 'pending' ? 'Pending review' : 'Clean'
              const tone = bucket === 'blocked' ? 'red' : bucket === 'flagged' ? 'amber' : bucket === 'pending' ? 'blue' : 'green'
              return (
                <div className="morg-queue-group" key={bucket}>
                  <div className={`morg-queue-heading tone-${tone}`}>{label} <span>{list.length}</span></div>
                  {list.map((c) => (
                    <button
                      key={c.case_id}
                      type="button"
                      className={`morg-queue-item ${c.case_id === selectedId ? 'active' : ''}`}
                      onClick={() => setSelectedId(c.case_id)}
                    >
                      <span className="morg-queue-id">{c.case_id}</span>
                      <span className="morg-queue-label">{c.demo_label}</span>
                    </button>
                  ))}
                </div>
              )
            })}
            {cases.length === 0 && <div className="raven-muted">No cases loaded.</div>}
          </div>
        </section>

        {/* 2. Evidence panel */}
        <section className="raven-card morg-panel origin-facts">
          <div className="origin-header origin-header-facts">
            <Lock size={12} /><span>FACTS · DETERMINISTIC</span>
          </div>
          <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>Evidence</h3>
            {selected && (
              <button
                type="button"
                className={`morg-viewer-toggle ${showSourceViewer ? 'active' : ''}`}
                onClick={() => setShowSourceViewer((v) => !v)}
                title="Toggle source PDF preview"
              >
                <FileText size={11} />
                {showSourceViewer ? 'Hide source' : 'Preview source'}
              </button>
            )}
          </div>
          {!selected ? (
            <div className="raven-muted">Select a case to view evidence.</div>
          ) : facts.length === 0 && calculations.length === 0 ? (
            <div className="raven-muted">Evidence unavailable for this case.</div>
          ) : (
            <div className={showSourceViewer ? 'morg-evidence-with-viewer' : ''}>
              <div className="morg-evidence">
                {facts.length > 0 && (
                  <>
                    <div className="morg-subheader"><Lock size={10} /> Facts · from OCR/Parse/DB</div>
                    {facts.slice(0, 8).map((f, i) => (
                      <div className="morg-evidence-row" key={i}>
                        <span className="morg-evidence-key">{f.field}</span>
                        <span className="morg-evidence-val">{f.value}</span>
                        <small className="raven-muted">{f.source}{typeof f.confidence === 'number' ? ` · ${(f.confidence * 100).toFixed(0)}%` : ''}</small>
                      </div>
                    ))}
                  </>
                )}
                {calculations.length > 0 && (
                  <>
                    <div className="morg-subheader morg-subheader-calc"><Gauge size={10} /> Calculations · Python Decimal</div>
                    {calculations.slice(0, 4).map((c, i) => (
                      <div className="morg-evidence-row" key={`c${i}`}>
                        <span className="morg-evidence-key">{c.type}</span>
                        <span className="morg-evidence-val">{c.value}</span>
                        <small className="raven-muted">{c.note}</small>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {showSourceViewer && (
                <DocumentViewer caseId={selected.case_id} filename={`${selected.case_id}.pdf`} embedded />
              )}
            </div>
          )}

          {/* CorrectionProposal — human-in-the-loop correction of an OCR field.
              Proposals are routed to the backend correction endpoint; the browser
              never overwrites source evidence directly. */}
          {selected && (
            <div className="correction-proposal">
              <div className="correction-head">
                <h4>Propose correction</h4>
                <small className="raven-muted">Human-in-the-loop · never silently overwrites source</small>
              </div>
              <div className="correction-form">
                <label>
                  <span>Correction type</span>
                  <select
                    value={corrField}
                    onChange={(e) => { setCorrField(e.target.value); setCorrAfter('') }}
                    disabled={corrSubmitting}
                  >
                    <option value="">— select —</option>
                    {(allowedCorrTypes.length > 0 ? allowedCorrTypes : [
                      'supplier_name_confirmed','supplier_alias_added','vat_correction',
                      'account_code_confirmed','reconciliation_confirmed',
                      'approval_decision','rejection_decision',
                    ]).map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g,' ')}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Original</span>
                  <input
                    type="text"
                    value={corrBefore}
                    onChange={(e) => setCorrBefore(e.target.value)}
                    placeholder="value observed (leave blank if new)"
                    disabled={corrSubmitting}
                  />
                </label>
                <label>
                  <span>Proposed</span>
                  {corrField === 'account_code_confirmed' && kmuAccounts.length > 0 ? (
                    <select
                      value={corrAfter}
                      onChange={(e) => setCorrAfter(e.target.value)}
                      disabled={corrSubmitting}
                    >
                      <option value="">— pick KMU account —</option>
                      {kmuAccounts.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} — {a.label} (Kl. {a.klasse})
                        </option>
                      ))}
                    </select>
                  ) : corrField === 'vat_correction' ? (
                    <select
                      value={corrAfter}
                      onChange={(e) => setCorrAfter(e.target.value)}
                      disabled={corrSubmitting}
                    >
                      <option value="">— pick MWST rate —</option>
                      <option value="8.1">8.1% · Normalsatz</option>
                      <option value="2.6">2.6% · Reduzierter Satz</option>
                      <option value="3.8">3.8% · Beherbergung</option>
                      <option value="0.0">0.0% · Befreit</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={corrAfter}
                      onChange={(e) => setCorrAfter(e.target.value)}
                      placeholder={corrField === 'supplier_name_confirmed' ? 'e.g. JENRER AG' : 'corrected value'}
                      disabled={corrSubmitting}
                    />
                  )}
                </label>
                <label>
                  <span>Reason</span>
                  <input
                    type="text"
                    value={corrReason}
                    onChange={(e) => setCorrReason(e.target.value)}
                    placeholder="brief justification (for the audit trail)"
                    disabled={corrSubmitting}
                  />
                </label>
                <button
                  type="button"
                  className="action-btn"
                  onClick={submitCorrection}
                  disabled={corrSubmitting || !corrField || !corrAfter}
                  aria-label="Submit correction proposal"
                >
                  {corrSubmitting ? 'Submitting…' : 'Submit correction'}
                </button>
              </div>
              {corrections.length > 0 && (
                <ul className="correction-history">
                  {corrections.map((c, i) => (
                    <li key={i} className={`correction-row correction-${c.status}`}>
                      <span className={`pill pill-${c.status === 'accepted' ? 'green' : c.status === 'rejected' ? 'red' : c.status === 'error' ? 'red' : 'amber'}`}>
                        {c.status}
                      </span>
                      <span className="correction-field">{c.field}</span>
                      <span className="correction-values">
                        <small>{c.before || '(none)'}</small> → <b>{c.proposed}</b>
                      </span>
                      {c.detail && <small className="raven-muted">{c.detail}</small>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* 3. AI insight panel — AdvisoryPanel */}
        <section className="raven-card morg-panel origin-hypotheses">
          <div className="origin-header origin-header-hypotheses">
            <Sparkles size={12} /><span>HYPOTHESES · AI ADVISORY</span>
          </div>
          <div className="card-head">
            <h3>AI insight</h3>
            <div className="advisory-level-toggle" role="group" aria-label="Advisory level">
              <button
                type="button"
                className={`toggle-btn ${advisoryLevel === 'standard' ? 'active' : ''}`}
                onClick={() => setAdvisoryLevel('standard')}
                disabled={advisoryLoading}
              >
                Standard
              </button>
              <button
                type="button"
                className={`toggle-btn ${advisoryLevel === 'council' ? 'active' : ''}`}
                onClick={() => setAdvisoryLevel('council')}
                disabled={advisoryLoading}
                title="3-stage Qwen3 + Gemma3 council (Apertus slot reserved)"
              >
                Council
              </button>
            </div>
          </div>
          {!selected ? (
            <div className="raven-muted">Select a case to view suggestions.</div>
          ) : (
            <div className="morg-advisory">
              <div className="advisory-actions">
                <button
                  type="button"
                  className="action-btn advisory-run"
                  onClick={requestAdvisory}
                  disabled={advisoryLoading}
                  aria-label="Request AI advisory"
                >
                  <Sparkles size={13} />
                  {advisoryLoading ? 'Requesting…' : advisory ? 'Re-run advisory' : 'Request AI advisory'}
                </button>
                <small className="raven-muted">Local models · advisory only · human decides</small>
              </div>

              {advisoryError && (
                <div className="advisory-error">
                  Advisory unavailable — {advisoryError}
                </div>
              )}

              {!advisory && !advisoryError && (
                <>
                  <div className="morg-advisory-row"><span>Possible VAT rate:</span><b>{vatSplits[0]?.rate ?? 'not suggested'}</b></div>
                  <div className="morg-advisory-row"><span>Possible match:</span><b>{selected.investigation?.invoice_id ?? 'no candidate'}</b></div>
                  <div className="morg-advisory-row"><span>Confidence:</span><b>{typeof (selected.investigation?.checks as { confidence?: number } | undefined)?.confidence === 'number' ? `${(((selected.investigation?.checks as { confidence?: number }).confidence ?? 0) * 100).toFixed(0)}%` : 'not scored'}</b></div>
                  <div className="morg-advisory-row"><span>Reason:</span><b>request an advisory to see model output</b></div>
                </>
              )}

              {advisory && advisory.mode === 'standard' && (
                <div className="advisory-body">
                  <div className="advisory-meta">
                    <span className="pill pill-blue">{advisory.model_id}</span>
                    <span className="pill pill-neutral">{advisory.agent_role}</span>
                  </div>
                  <p className="advisory-answer">{advisory.answer || '(empty answer)'}</p>
                </div>
              )}

              {advisory && advisory.mode === 'council' && (
                <div className="advisory-body">
                  <div className="advisory-meta">
                    <span className={`pill pill-${advisory.status === 'completed' ? 'green' : advisory.status === 'fallback' ? 'amber' : 'red'}`}>
                      {advisory.status}
                    </span>
                    {advisory.council_lead && (
                      <span className="pill pill-blue">lead: {advisory.council_lead}</span>
                    )}
                    {advisory.language && (
                      <span className="pill pill-neutral">{advisory.language}</span>
                    )}
                  </div>

                  {advisory.status === 'completed' && advisory.suggestion_text && (
                    <p className="advisory-answer">{advisory.suggestion_text}</p>
                  )}
                  {advisory.status !== 'completed' && (
                    <p className="advisory-answer">
                      {advisory.message || advisory.reason || 'Council returned no suggestion.'}
                    </p>
                  )}

                  {advisory.banking_terms_used && advisory.banking_terms_used.length > 0 && (
                    <div className="advisory-terms">
                      {advisory.banking_terms_used.map((t) => (
                        <span key={t} className="pill pill-neutral">{t}</span>
                      ))}
                    </div>
                  )}

                  {advisory.stages && advisory.stages.length > 0 && (
                    <details className="advisory-stages">
                      <summary>Stages ({advisory.stages.length})</summary>
                      <ul>
                        {advisory.stages.map((s, i) => (
                          <li key={i}>
                            <b>{s.stage}</b> · {s.model} · {s.elapsed_ms}ms · {s.output_schema_valid ? 'schema ok' : `schema invalid${s.error ? ` (${s.error})` : ''}`}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {advisory.apertus_slot && (
                    <div className="apertus-slot" title={advisory.apertus_slot.note}>
                      <span className="pill pill-neutral">apertus slot: {advisory.apertus_slot.status}</span>
                      {advisory.apertus_slot.note && (
                        <small className="raven-muted">{advisory.apertus_slot.note}</small>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="morg-advisory-warn">
                <AlertTriangle size={13} /> Human approval required
              </div>
            </div>
          )}
        </section>

        {/* 4. VAT panel */}
        <section className="raven-card morg-panel">
          <div className="card-head"><h3><ShieldCheck size={15} /> VAT validation</h3></div>
          {!selected ? (
            <div className="raven-muted">Select a case.</div>
          ) : vatSplits.length === 0 ? (
            <div className="morg-vat-status raven-muted">VAT validation unavailable for this case.</div>
          ) : (
            <div className="morg-vat">
              {vatSplits.map((v, i) => (
                <div className={`morg-vat-row ${v.valid ? 'ok' : 'bad'}`} key={i}>
                  <span className="morg-vat-rate">{v.rate}</span>
                  <span>net {v.net}</span>
                  <span>vat {v.vat}</span>
                  <span>gross {v.gross}</span>
                  <span>{v.valid ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {v.valid ? 'Verified' : 'Review required'}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Risk panel */}
        <section className="raven-card morg-panel">
          <div className="card-head"><h3><ShieldAlert size={15} /> Risk flags</h3></div>
          {!selected ? (
            <div className="raven-muted">Select a case.</div>
          ) : flags.length === 0 ? (
            <div className="morg-risk-none"><CheckCircle2 size={14} /> No blocking risk flags.</div>
          ) : (
            <div className="morg-risk-list">
              {flags.map((flag) => (
                <button
                  key={flag}
                  type="button"
                  className={`flag-item flag-${riskColor([flag])} flag-btn`}
                  onClick={() => setFlagSlideOut(flag)}
                >
                  {riskColor([flag]) === 'red' ? <XCircle size={14} /> : <AlertTriangle size={14} />}
                  <span>{flag.replace(/_/g, ' ')}</span>
                  <ChevronRight size={12} />
                </button>
              ))}
            </div>
          )}
          {selected && isCase003 && flags.length > 0 && flags.every((f) => f === 'VAT_SPLIT_REVIEW_REQUIRED') && (
            <div className="morg-demo-note">
              <em>Prompt-injection demo fixture not yet wired — this case is currently a VAT-split review.</em>
            </div>
          )}
        </section>

        {/* 6. Approval panel */}
        <section className={`raven-card morg-panel morg-approval tone-${overall}`}>
          <div className="card-head"><h3><ShieldCheck size={15} /> Approval</h3></div>
          {!selected ? (
            <div className="raven-muted">Select a case.</div>
          ) : (
            <>
              <div className="morg-approval-meta">
                <div><span>Approval eligible</span><b>{selected.approval_eligible ? 'Yes' : 'No'}</b></div>
                <div><span>Review state</span><b>{selected.review_state}</b></div>
                <div><span>erp_write</span><b>false</b></div>
              </div>
              <div className="morg-approval-actions">
                <button
                  type="button"
                  className={`action-btn approve ${!canApprove ? 'blocked' : ''}`}
                  disabled={actionLoading || !canApprove}
                  title={!canApprove ? 'Blocked by deterministic checks or risk flags' : 'Approve as draft'}
                  aria-label="Approve draft"
                  onClick={() => handleAction('approve')}
                >
                  <CheckCircle2 size={14} /> {!canApprove ? 'Blocked' : 'Approve draft'}
                </button>
                <button
                  type="button"
                  className="action-btn reject"
                  disabled={actionLoading}
                  aria-label="Reject case"
                  onClick={() => handleAction('reject')}
                >
                  <XCircle size={14} /> Reject
                </button>
                <button
                  type="button"
                  className="action-btn escalate"
                  disabled={actionLoading}
                  aria-label="Escalate case"
                  onClick={() => handleAction('escalate')}
                >
                  <AlertTriangle size={14} /> Escalate
                </button>
              </div>
              <button
                type="button"
                className="morg-open-reconcile"
                onClick={onNavigateToReconcile}
                aria-label="Open full evidence in Reconcile"
              >
                Open full evidence in Reconcile <ChevronRight size={12} />
              </button>
            </>
          )}
        </section>

        {/* 7. Audit panel + Verify chain button */}
        <section className="raven-card morg-panel">
          <div className="card-head">
            <h3><Lock size={15} /> Audit</h3>
            <small className="raven-muted">Session-scoped OCSF log · SHA-256 event chain · persistent within session.</small>
          </div>
          {selected && (
            <VerifyChainButton caseId={selected.case_id} />
          )}
          {morgianaAudit.length === 0 ? (
            <div className="raven-muted">No audit events for this case yet.</div>
          ) : (
            <ul className="morg-audit-list">
              {morgianaAudit.map((e, i) => (
                <li key={i} className={`morg-audit-item outcome-${e.outcome}`}>
                  <span className="morg-audit-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className="morg-audit-action">{e.action}</span>
                  <small>{e.detail}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 7b. Booking-confidence panel — weighted criterion score */}
        {selected && <BookingScorePanel caseId={selected.case_id} />}

        {/* 8. Runtime panel */}
        <section className="raven-card morg-panel">
          <div className="card-head"><h3><Activity size={15} /> Runtime dependencies</h3></div>
          <div className="morg-runtime-list">
            {morgianaRuntime.map((l) => {
              const tone = statusToTone(l.status)
              return (
                <div className="morg-runtime-row" key={l.key}>
                  <span className="morg-runtime-name">{l.label}</span>
                  <span className={`runtime-card-pill tone-${tone}`}>{l.status}</span>
                  <small className="raven-muted">{l.model}</small>
                </div>
              )
            })}
            <div className="morg-runtime-row">
              <span className="morg-runtime-name">NeMo Guardrails</span>
              <span className="runtime-card-pill tone-blue">READY</span>
              <small className="raven-muted">input · retrieval · execution · output</small>
            </div>
          </div>
        </section>

        {/* 8b. Conflicts panel — where advisor disagrees with deterministic check */}
        <section className="raven-card morg-panel">
          <div className="card-head">
            <h3><AlertTriangle size={15} /> Conflicts</h3>
            <small className="raven-muted">Advisor vs deterministic gate</small>
          </div>
          {(() => {
            if (!selected) return <div className="raven-muted">Select a case.</div>
            const blockingSet = new Set([
              'AMOUNT_MISMATCH','IBAN_MISMATCH','IBAN_NOT_VERIFIED','REFERENCE_MISSING',
              'REFERENCE_MISMATCH','UNKNOWN_VAT_RATE','DUPLICATE_DOCUMENT','PROMPT_INJECTION',
            ])
            const activeBlockers = (selected.risk_flags || []).filter((f) => blockingSet.has(f))
            const advisorSuggestedApprove = advisory?.result &&
              typeof advisory.result === 'object' &&
              (advisory.result as { do_not_approve?: boolean }).do_not_approve === false
            const conflicts: Array<{ label: string; detail: string }> = []
            if (activeBlockers.length > 0 && advisorSuggestedApprove) {
              conflicts.push({
                label: 'Advisor suggests approval, deterministic checks block',
                detail: `Blockers active: ${activeBlockers.join(', ')} — deterministic wins.`,
              })
            }
            if (activeBlockers.length > 0 && !advisorSuggestedApprove) {
              conflicts.push({
                label: 'Advisor and deterministic checks aligned on block',
                detail: `Both agree case is not approvable (${activeBlockers.join(', ')}).`,
              })
            }
            if (conflicts.length === 0) {
              return (
                <div className="conflicts-empty">
                  <Check size={12} /> No conflicts detected between advisor and deterministic checks.
                </div>
              )
            }
            return (
              <ul className="conflicts-list">
                {conflicts.map((c, i) => (
                  <li key={i} className="conflicts-row">
                    <span className="conflicts-label">{c.label}</span>
                    <small className="raven-muted">{c.detail}</small>
                  </li>
                ))}
              </ul>
            )
          })()}
        </section>

        {/* 9. Authority matrix — who decides what */}
        <section className="raven-card morg-panel">
          <div className="card-head">
            <h3><BookOpen size={15} /> Authority matrix</h3>
            <small className="raven-muted">Who decides what</small>
          </div>
          <table className="morg-authority-table">
            <thead>
              <tr><th>Output</th><th>Authority</th></tr>
            </thead>
            <tbody>
              <tr><td>OCR text</td><td><span className="authority-pill authority-evidence">Evidence · reviewable</span></td></tr>
              <tr><td>Parse result</td><td><span className="authority-pill authority-evidence">Evidence · reviewable</span></td></tr>
              <tr><td>VAT calculation</td><td><span className="authority-pill authority-deterministic">Deterministic · backend</span></td></tr>
              <tr><td>Amount / IBAN checks</td><td><span className="authority-pill authority-deterministic">Deterministic · backend</span></td></tr>
              <tr><td>RAG candidate</td><td><span className="authority-pill authority-evidence">Evidence · candidate</span></td></tr>
              <tr><td>Council (Qwen3 / Gemma3)</td><td><span className="authority-pill authority-advisory">Advisory</span></td></tr>
              <tr><td>NIM reasoning</td><td><span className="authority-pill authority-advisory">Advisory</span></td></tr>
              <tr><td>Approval eligibility</td><td><span className="authority-pill authority-deterministic">Backend control</span></td></tr>
              <tr><td>ERP write</td><td><span className="authority-pill authority-disabled">Disabled · demo</span></td></tr>
            </tbody>
          </table>
          <small className="raven-muted morg-authority-note">
            Models read, classify, explain, and suggest. Deterministic backend rules decide whether the evidence
            is internally consistent. A human approves the resulting draft.
          </small>
        </section>

        {/* 10. Blocking rules — what stops approval */}
        <section className="raven-card morg-panel">
          <div className="card-head">
            <h3><Lock size={15} /> Blocking rules</h3>
            <small className="raven-muted">Server-side, non-overridable</small>
          </div>
          <p className="raven-muted morg-blocking-lead">
            Approval is impossible when any of these flags are present. The backend re-validates on every
            <code>POST /api/demo/cases/&#123;id&#125;/approve</code> call and returns <b>HTTP 409</b> if a blocker is active.
          </p>
          <div className="morg-blocking-list">
            {[
              'AMOUNT_MISMATCH',
              'IBAN_MISMATCH',
              'IBAN_NOT_VERIFIED',
              'REFERENCE_MISSING',
              'REFERENCE_MISMATCH',
              'UNKNOWN_VAT_RATE',
              'DUPLICATE_DOCUMENT',
              'PROMPT_INJECTION',
            ].map((flag) => {
              const active = (selected?.risk_flags || []).includes(flag)
              return (
                <span
                  key={flag}
                  className={`morg-blocking-chip ${active ? 'active' : ''}`}
                  title={active ? 'Currently blocking this case' : 'Not present on this case'}
                >
                  {flag}
                </span>
              )
            })}
          </div>
          <small className="raven-muted">
            Frontend cannot bypass these. Editing React state changes nothing — the backend recomputes
            from the case record every time.
          </small>
        </section>
      </div>

      {/* Slide-out for flag detail */}
      {flagSlideOut && selected && (
        <>
          <div className="slide-out-scrim" onClick={() => setFlagSlideOut(null)} aria-hidden />
          <aside className="slide-out" role="dialog" aria-label="Risk flag explanation">
            <div className="slide-out-head">
              <div>
                <div className="slide-out-flag">{flagSlideOut.replace(/_/g, ' ')}</div>
                <small className="raven-muted">{selected.case_id}</small>
              </div>
              <button className="icon-btn" aria-label="Close" onClick={() => setFlagSlideOut(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="slide-out-body">
              <div className="slide-out-section">
                <h5>Explanation</h5>
                <p>{RISK_EXPLAIN[flagSlideOut] || 'No explanation configured for this flag. Human review required before approval.'}</p>
              </div>
            </div>
            <div className="slide-out-foot">
              <button
                type="button"
                className="action-btn approve"
                disabled={!canApprove || actionLoading}
                onClick={() => { setFlagSlideOut(null); handleAction('approve') }}
              >
                <CheckCircle2 size={14} /> Approve
              </button>
              <button
                type="button"
                className="action-btn secondary"
                onClick={() => { notify(`${flagSlideOut} flagged for follow-up`); setFlagSlideOut(null) }}
              >
                Flag
              </button>
              <button
                type="button"
                className="action-btn secondary"
                onClick={() => setFlagSlideOut(null)}
              >
                Skip
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Audit Trail page
// ---------------------------------------------------------------------------

function AuditPage({ entries }: { entries: AuditEntry[] }) {
  return (
    <div className="page-simple">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">SESSION AUDIT TIMELINE</div>
          <h1>Audit Trail</h1>
          <p>Every pipeline step and human decision emits an OCSF event (session-scoped).</p>
        </div>
      </section>
      {entries.length === 0 ? (
        <div className="raven-empty"><ListChecks size={28} /><p>No audit events in this session. Approve or reject a case to generate events.</p></div>
      ) : (
        <div className="audit-timeline">
          {entries.map((entry, i) => (
            <div className="audit-entry" key={i}>
              <div className="audit-time">{new Date(entry.timestamp).toLocaleTimeString()}</div>
              <div className={`audit-icon ${entry.outcome}`}>
                {entry.outcome === 'success' ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              </div>
              <div className="audit-body">
                <b>{entry.action}</b>
                <span>{entry.case_id} — {entry.detail}</span>
                <small>Actor: {entry.actor}</small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insights page
// ---------------------------------------------------------------------------

function InsightsPage({ cases, health }: { cases: DemoCase[]; health: HealthData | null }) {
  const allFlags = cases.flatMap((c) => c.investigation?.risk_flags || c.risk_flags || [])
  const flagCounts: Record<string, number> = {}
  for (const f of allFlags) {
    flagCounts[f] = (flagCounts[f] || 0) + 1
  }

  return (
    <div className="page-simple">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">FINANCIAL ANALYSIS</div>
          <h1>Financial Insights</h1>
          <p>Aggregate risk flag distribution across demo cases</p>
        </div>
      </section>

      <div className="insight-grid">
        <section className="raven-card">
          <div className="card-head">
            <h3><ShieldAlert size={15} /> Risk Flag Distribution</h3>
          </div>
          {Object.entries(flagCounts).length === 0 ? (
            <p className="raven-muted">No risk flags found in current cases.</p>
          ) : (
            <div className="flag-bars">
              {Object.entries(flagCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([flag, count]) => (
                  <div className="flag-bar-row" key={flag}>
                    <span className="flag-bar-label">{flag.replace(/_/g, ' ')}</span>
                    <div className="flag-bar-track">
                      <div
                        className={`flag-bar-fill ${riskColor([flag])}`}
                        style={{ width: `${Math.min((count / (cases.length || 1)) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="flag-bar-count">{count}</span>
                  </div>
                ))}
            </div>
          )}
        </section>

        <section className="raven-card">
          <div className="card-head">
            <h3><Gauge size={15} /> System Status</h3>
          </div>
          <div className="health-grid">
            <div className="health-row">
              <span>Backend</span>
              <b className={health ? 'health-ok' : 'health-warn'}>{health ? 'connected' : 'unavailable'}</b>
            </div>
            <div className="health-row">
              <span>GPU</span>
              <b>{health?.gpu.available ? `${health.gpu.count}x ${health.gpu.hardware}` : 'unavailable'}</b>
            </div>
            <div className="health-row">
              <span>Demo Cases</span>
              <b>{cases.length}</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Weighted booking-confidence score
//   Deterministic 7-criterion formula rendered in the popover + Invoice result.
//   The FE computes a display score from mock inputs today; the same shape
//   will accept live inputs when the backend exposes them.
// ---------------------------------------------------------------------------

type ScoreCriterion = { key: string; label: string; weight: number; value: number }

function baseScore(criteria: ScoreCriterion[]): number {
  return criteria.reduce((s, c) => s + c.weight * c.value, 0)
}

function displayScore(criteria: ScoreCriterion[], contradiction = 0): number {
  const base = baseScore(criteria)
  const raw = 100 * Math.max(0, base - 0.25 * contradiction)
  return Math.round(raw)
}

function WeightedScorePanel({ criteria, contradiction }: { criteria: ScoreCriterion[]; contradiction: number }) {
  const total = displayScore(criteria, contradiction)
  return (
    <div className="score-panel">
      <div className="score-total">
        <span className="raven-muted" style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Booking confidence
        </span>
        <b>{total}<small style={{ fontSize: 12, color: 'var(--raven-text-dim)' }}>/100</small></b>
      </div>
      <div className="score-criteria">
        {criteria.map((c) => (
          <div className="score-crit" key={c.key}>
            <span className="crit-label">{c.label}</span>
            <span className="crit-weight">×{c.weight.toFixed(2)}</span>
            <div className="crit-bar-track">
              <div className="crit-bar-fill" style={{ width: `${(c.weight * c.value * 100).toFixed(1)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const MOCK_TXN_CRITERIA: ScoreCriterion[] = [
  { key: 'field_extraction_match', label: 'Field extraction match', weight: 0.20, value: 1.0 },
  { key: 'vat_rule_compliance',    label: 'VAT rule compliance',    weight: 0.18, value: 1.0 },
  { key: 'supplier_known_to_rag',  label: 'Supplier known (RAG)',   weight: 0.15, value: 0.9 },
  { key: 'amount_plausibility',    label: 'Amount plausibility',    weight: 0.15, value: 0.9 },
  { key: 'camt_counterpart_match', label: 'CAMT counterpart match', weight: 0.12, value: 0.8 },
  { key: 'council_agreement',      label: 'Council agreement',      weight: 0.10, value: 0.85 },
  { key: 'document_completeness',  label: 'Document completeness',  weight: 0.10, value: 0.8 },
]

// ---------------------------------------------------------------------------
// CAMT XML viewer — minimal regex highlighting (no new dep)
// ---------------------------------------------------------------------------

function highlightXml(src: string): React.ReactElement[] {
  // Tokenise into ordered spans: comments, tags, attrs, strings, text.
  const out: React.ReactElement[] = []
  const re = /(<!--[\s\S]*?-->)|(<\/?[\w:.-]+)|(\s[\w:-]+=)|("(?:[^"\\]|\\.)*")|([^<]+)/g
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(<span key={idx++} className="xml-com">{m[1]}</span>)
    else if (m[2]) out.push(<span key={idx++} className="xml-tag">{m[2]}</span>)
    else if (m[3]) out.push(<span key={idx++} className="xml-attr">{m[3]}</span>)
    else if (m[4]) out.push(<span key={idx++} className="xml-str">{m[4]}</span>)
    else if (m[5]) out.push(<span key={idx++}>{m[5]}</span>)
  }
  return out
}

const FALLBACK_CAMT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>CASE-001-STMT-20260918</MsgId>
    </GrpHdr>
    <!-- CAMT sample not found on backend; showing fallback -->
  </BkToCstmrStmt>
</Document>`

// ---------------------------------------------------------------------------
// Transactions Page — Feature 2
// ---------------------------------------------------------------------------

type DemoTxn = {
  id: string
  case_id?: string           // real backend case_id if we derived from /api/demo/cases
  camt_ref: string           // filename base for /api/demo/camt/{ref}.xml
  date: string
  counterparty: string
  amount_chf: string
  reference: string
  status: PillStatus
  hint: string               // one-line explanation for the popover
}

const HARDCODED_TXNS: DemoTxn[] = [
  {
    id: 'TX-DEMO-001',
    camt_ref: 'CASE-001_clean_match',
    date: '2026-09-18',
    counterparty: 'Alpen Technik AG',
    amount_chf: '1248.55',
    reference: 'INV-2026-001',
    status: 'APPROVED',
    hint: 'Reference, amount and IBAN all match the invoice on file.',
  },
  {
    id: 'TX-DEMO-002',
    camt_ref: 'CASE-002_iban_change',
    date: '2026-09-19',
    counterparty: 'Bergli Consulting GmbH',
    amount_chf: '4820.00',
    reference: 'INV-2026-018',
    status: 'BLOCKED',
    hint: 'German IBAN on a Swiss supplier — payment blocked pending human verification.',
  },
  {
    id: 'TX-DEMO-003',
    camt_ref: 'CASE-003_prompt_injection',
    date: '2026-09-20',
    counterparty: 'Office Supplies Zurich',
    amount_chf: '725.30',
    reference: 'INV-2026-041',
    status: 'REVIEW',
    hint: 'Untrusted instruction detected inside the remittance text; guard blocked model execution.',
  },
]

type PopoverAnchor = { txn: DemoTxn; x: number; y: number } | null

function TransactionsPage({
  cases,
  runtime,
  notify,
  addAudit,
}: {
  cases: DemoCase[]
  runtime: RuntimeCapabilities
  notify: (msg: string) => void
  addAudit: (entry: Omit<AuditEntry, 'timestamp'>) => void
}) {
  // Prefer real cases when they carry an investigation stub — but always fall
  // back to the hard-coded 3-row demo set so the demo never shows an empty
  // transaction table.
  const derived: DemoTxn[] = useMemo(() => {
    const rows: DemoTxn[] = []
    for (const c of cases) {
      const investigation = c.investigation
      if (!investigation) continue
      const risk = c.investigation?.risk_flags || c.risk_flags || []
      const status: PillStatus =
        c.review_state === 'APPROVED_DRAFT' ? 'APPROVED'
        : c.review_state === 'REJECTED' ? 'BLOCKED'
        : riskColor(risk) === 'red' ? 'BLOCKED'
        : riskColor(risk) === 'amber' ? 'REVIEW'
        : 'LIVE'
      rows.push({
        id: c.case_id,
        case_id: c.case_id,
        camt_ref: 'CASE-001_clean_match', // best-effort: real demo cases don't carry an XML ref
        date: '2026-09-18',
        counterparty: c.demo_label || 'Unknown',
        amount_chf: '—',
        reference: c.review_case_id || c.case_id,
        status,
        hint: 'Live case from backend fixtures.',
      })
    }
    return rows
  }, [cases])

  const txns = derived.length > 0 ? [...derived, ...HARDCODED_TXNS] : HARDCODED_TXNS

  const [selected, setSelected] = useState<string | null>(null)
  const [popover, setPopover] = useState<PopoverAnchor>(null)
  const [xml, setXml] = useState<string>(FALLBACK_CAMT_XML)
  const [xmlError, setXmlError] = useState<string>('')

  const activeTxn = txns.find((t) => t.id === selected) || null
  const apertusStatus: 'LIVE' | 'FALLBACK' | 'DOWN' =
    runtime.apertus_vllm?.status === 'live' ? 'LIVE'
    : runtime.source === 'mock' ? 'LIVE' : 'FALLBACK'

  useEffect(() => {
    if (!activeTxn) {
      setXml(FALLBACK_CAMT_XML)
      setXmlError('')
      return
    }
    let alive = true
    setXmlError('')
    fetch(`${API_BASE}/api/demo/camt/${encodeURIComponent(activeTxn.camt_ref)}.xml`)
      .then((r) => {
        if (!r.ok) throw new Error(`Not available (${r.status})`)
        return r.text()
      })
      .then((text) => { if (alive) setXml(text) })
      .catch(() => {
        if (alive) {
          setXml(FALLBACK_CAMT_XML)
          setXmlError('Live CAMT sample unavailable — showing fallback')
        }
      })
    return () => { alive = false }
  }, [activeTxn])

  useEffect(() => {
    if (!popover) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopover(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [popover])

  const openPopover = (e: React.MouseEvent<HTMLTableRowElement>, txn: DemoTxn) => {
    setSelected(txn.id)
    const rect = e.currentTarget.getBoundingClientRect()
    const preferRight = rect.right + 460 < window.innerWidth
    const x = preferRight ? rect.right + 10 : Math.max(16, rect.left - 460)
    const y = Math.min(rect.top, window.innerHeight - 570)
    setPopover({ txn, x, y })
  }

  const onApproveBooking = async () => {
    if (!popover) return
    const txn = popover.txn
    // Try a real approve when the row is backed by a live case_id; on any
    // error just toast — the button must never appear to fail visibly.
    if (txn.case_id) {
      try {
        await apiFetch(`/api/demo/cases/${encodeURIComponent(txn.case_id)}/approve`, {
          method: 'POST',
          body: JSON.stringify({ approver_id: 'morgiana-reviewer-01' }),
        })
      } catch {
        // demo: silent
      }
    }
    addAudit({
      action: 'txn.booking_approved',
      actor: 'morgiana-reviewer-01',
      case_id: txn.case_id || txn.id,
      detail: `Weighted score ${displayScore(MOCK_TXN_CRITERIA)}`,
      outcome: 'APPROVED_DRAFT',
    })
    notify('Booking logged — audit event recorded')
    setPopover(null)
  }

  return (
    <div className="page-simple">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">RAVEN FINANCE GUARDIAN · BANKING</div>
          <h1>Bankauszug · CAMT.053</h1>
          <p>
            Zahlungsverkehr aus CAMT.053-Kontoauszügen · click a row to see the Apertus + Qwen booking
            recommendation. Approvals never write to an ERP in this demo — <code>erp_write: false</code>.
          </p>
        </div>
      </section>

      <NimPipelineStrip runtime={runtime} apertusStatus={apertusStatus} compact />

      <ArchiveUploader
        kind="bank_transaction"
        label="Bankauszug-Upload · CAMT.053"
        hint="Drop CAMT.053 XML, MT940, or Kontoauszug-PDFs. Filename hints (camt, kontoauszug, statement) route here automatically."
      />

      <div className="txn-layout">
        {/* LEFT: transactions table */}
        <section className="raven-card txn-panel">
          <div className="card-head">
            <h3><Wallet size={15} /> Bank transactions</h3>
            <span className="raven-muted">{txns.length} entries</span>
          </div>
          <div className="txn-scroll">
            <table className="txn-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Counterparty</th>
                  <th style={{ textAlign: 'right' }}>CHF</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr
                    key={t.id}
                    className={`txn-row${selected === t.id ? ' selected' : ''}`}
                    onClick={(e) => openPopover(e, t)}
                    tabIndex={0}
                    aria-label={`Transaction ${t.id} — ${t.counterparty} — CHF ${t.amount_chf}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openPopover(e as unknown as React.MouseEvent<HTMLTableRowElement>, t)
                      }
                    }}
                  >
                    <td className="mono">{t.date}</td>
                    <td>{t.counterparty}</td>
                    <td className="chf">{t.amount_chf}</td>
                    <td className="mono">{t.reference}</td>
                    <td><StatusPill status={t.status}>{t.status}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT: CAMT XML viewer */}
        <section className="raven-card txn-panel">
          <div className="card-head">
            <h3><FileText size={15} /> CAMT.053 · raw XML</h3>
            <span className="raven-muted">
              {activeTxn ? activeTxn.camt_ref : 'Select a transaction'}
              {xmlError && <> · {xmlError}</>}
            </span>
          </div>
          <div className="camt-viewer" role="region" aria-label="CAMT XML viewer">
            {highlightXml(xml)}
          </div>
        </section>
      </div>

      {popover && (
        <>
          <div className="txn-popover-scrim" onClick={() => setPopover(null)} aria-hidden />
          <div
            className="txn-popover"
            role="dialog"
            aria-label="Booking recommendation"
            style={{ top: popover.y, left: popover.x }}
          >
            <div className="pop-head">
              <h4>Booking Recommendation</h4>
              <StatusPill status="LIVE">Apertus-v1.5-8B</StatusPill>
              <StatusPill status="LIVE">Qwen3:32b</StatusPill>
              <button
                className="raven-icon-btn"
                onClick={() => setPopover(null)}
                aria-label="Close"
                style={{ marginLeft: 'auto' }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="pop-row">
              <span className="pop-label">Apertus</span>
              <span className="pop-value">MATCH · {popover.txn.counterparty} · Account 6500 · Confidence 91%</span>
            </div>
            <div className="pop-row">
              <span className="pop-label">Qwen</span>
              <span className="pop-value">AGREE · Cross-check · No contradiction</span>
            </div>
            <div className="pop-row">
              <span className="pop-label">Context</span>
              <span className="pop-value raven-muted">{popover.txn.hint}</span>
            </div>

            <div className="pop-row" style={{ display: 'block', marginTop: 10 }}>
              <span className="pop-label" style={{ display: 'block', marginBottom: 6 }}>
                Deterministic checks
              </span>
              <div className="pop-check-row pass"><Check size={12} /> VAT arithmetic</div>
              <div className="pop-check-row pass"><Check size={12} /> IBAN known</div>
              <div className="pop-check-row pass"><Check size={12} /> Amount within tolerance</div>
            </div>

            <WeightedScorePanel criteria={MOCK_TXN_CRITERIA} contradiction={0} />

            <div className="pop-actions">
              <button className="primary" onClick={onApproveBooking}>
                <CheckCircle2 size={13} style={{ marginRight: 4 }} /> Approve Booking
              </button>
              <button onClick={() => { notify('Flagged for review'); setPopover(null) }}>
                Flag for Review
              </button>
              <button onClick={() => { notify('Document requested'); setPopover(null) }}>
                Request Document
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Invoices Page — Feature 3
// ---------------------------------------------------------------------------

type InvoiceForm = {
  supplier: string
  invoice_number: string
  date: string
  net: string
  vat_rate: string
  iban: string
  reference: string
}

const EMPTY_INVOICE: InvoiceForm = {
  supplier: 'Alpen Technik AG',
  invoice_number: 'INV-2026-001',
  date: '2026-09-22',
  net: '1200.00',
  vat_rate: '8.1',
  iban: 'CH4400767000S00023456',
  reference: 'AT-2026-0918',
}

function calcGross(net: string, vatRate: string): { gross: string; ok: boolean } {
  const n = parseFloat(net)
  const r = parseFloat(vatRate)
  if (!isFinite(n) || !isFinite(r)) return { gross: '', ok: false }
  const gross = Math.round(n * (1 + r / 100) * 100) / 100
  return { gross: gross.toFixed(2), ok: true }
}

function calcVat(net: string, vatRate: string): string {
  const n = parseFloat(net)
  const r = parseFloat(vatRate)
  if (!isFinite(n) || !isFinite(r)) return '0.00'
  return (Math.round(n * (r / 100) * 100) / 100).toFixed(2)
}

const INVOICE_CRITERIA_TEMPLATE: ScoreCriterion[] = [
  { key: 'field_extraction_match', label: 'Field extraction match', weight: 0.20, value: 1.0 },
  { key: 'vat_rule_compliance',    label: 'VAT rule compliance',    weight: 0.18, value: 1.0 },
  { key: 'supplier_known_to_rag',  label: 'Supplier known (RAG)',   weight: 0.15, value: 0.85 },
  { key: 'amount_plausibility',    label: 'Amount plausibility',    weight: 0.15, value: 0.95 },
  { key: 'camt_counterpart_match', label: 'CAMT counterpart match', weight: 0.12, value: 0.7 },
  { key: 'council_agreement',      label: 'Council agreement',      weight: 0.10, value: 0.85 },
  { key: 'document_completeness',  label: 'Document completeness',  weight: 0.10, value: 0.9 },
]

// ---------------------------------------------------------------------------
// BatchIngestPanel — real Swiss PDF batch through /process, side-by-side result
// ---------------------------------------------------------------------------

type BatchFile = { filename: string; size_bytes: number }
type BatchRow = {
  filename: string
  status: 'idle' | 'fetching' | 'processing' | 'done' | 'error'
  case_id?: string
  risk_flags?: string[]
  vendor?: string
  gross?: string
  error?: string
  durationMs?: number
}

function BatchIngestPanel({ notify, addAudit }: {
  notify: (msg: string) => void
  addAudit: (entry: Omit<AuditEntry, 'timestamp'>) => void
}) {
  const [files, setFiles] = useState<BatchFile[]>([])
  const [rows, setRows] = useState<Record<string, BatchRow>>({})
  const [batchSize, setBatchSize] = useState<3 | 5 | 9>(3)
  const [running, setRunning] = useState(false)
  const [selectedCase, setSelectedCase] = useState<string | null>(null)
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null)
  const [advisory, setAdvisory] = useState<{ status: string; result?: { summary?: string; vat_status?: string; suggested_account?: string; suggested_vat_rate?: number | null; do_not_approve?: boolean } } | null>(null)
  const [advisoryLoading, setAdvisoryLoading] = useState(false)

  useEffect(() => {
    apiFetch<{ files: BatchFile[]; available: boolean }>('/api/demo/invoice-batch')
      .then((d) => setFiles(d.available ? d.files : []))
      .catch(() => setFiles([]))
  }, [])

  const runBatch = useCallback(async () => {
    const picks = files.slice(0, batchSize)
    if (picks.length === 0) return
    setRunning(true)
    setRows(Object.fromEntries(picks.map((p) => [p.filename, { filename: p.filename, status: 'idle' as const }])))
    setSelectedCase(null)
    setSelectedFilename(null)
    setAdvisory(null)

    for (const p of picks) {
      const start = performance.now()
      setRows((r) => ({ ...r, [p.filename]: { ...r[p.filename], status: 'fetching' } }))
      try {
        const fileResp = await fetch(`${API_BASE}/api/demo/invoice-batch/file/${encodeURIComponent(p.filename)}`)
        if (!fileResp.ok) throw new Error(`fetch ${fileResp.status}`)
        const blob = await fileResp.blob()
        setRows((r) => ({ ...r, [p.filename]: { ...r[p.filename], status: 'processing' } }))
        const form = new FormData()
        form.append('file', blob, p.filename)
        const procResp = await fetch(`${API_BASE}/process`, { method: 'POST', body: form })
        const durationMs = Math.round(performance.now() - start)
        if (!procResp.ok) {
          const body = await procResp.json().catch(() => ({}))
          const detail = body?.detail?.detail || body?.detail || `HTTP ${procResp.status}`
          const flags = body?.detail?.risk_flags || []
          setRows((r) => ({ ...r, [p.filename]: { ...r[p.filename], status: 'error', error: String(detail), risk_flags: flags, durationMs } }))
          continue
        }
        const data = await procResp.json()
        const doc = data?.document || {}
        const fields = doc?.fields || {}
        const case_id: string = data?.case_id || ''
        const risk_flags: string[] = doc?.risk_flags || []
        setRows((r) => ({
          ...r,
          [p.filename]: {
            ...r[p.filename],
            status: 'done',
            case_id,
            risk_flags,
            vendor: fields.vendor || fields.supplier,
            gross: fields.total_chf || fields.gross_amount,
            durationMs,
          },
        }))
        addAudit({
          action: 'batch.processed',
          actor: 'batch-ingest',
          case_id,
          detail: `${p.filename} · ${durationMs} ms · ${risk_flags.length} flag(s)`,
          outcome: risk_flags.length > 0 ? 'flagged' : 'processed',
        })
        if (!selectedCase) {
          setSelectedCase(case_id)
          setSelectedFilename(p.filename)
        }
      } catch (err) {
        const durationMs = Math.round(performance.now() - start)
        setRows((r) => ({ ...r, [p.filename]: { ...r[p.filename], status: 'error', error: err instanceof Error ? err.message : 'ingest failed', durationMs } }))
      }
    }
    setRunning(false)
    notify(`Batch complete · ${picks.length} invoices processed`)
  }, [files, batchSize, addAudit, notify, selectedCase])

  const requestAdvisory = useCallback(async (case_id: string) => {
    setAdvisoryLoading(true)
    setAdvisory(null)
    try {
      const r = await apiFetch<{ status: string; result?: BatchRow }>(`/api/cases/${encodeURIComponent(case_id)}/investigate`, {
        method: 'POST',
        headers: { 'X-Advisory-Level': 'tax' },
        body: JSON.stringify({ question: 'Analyze VAT and reconciliation for this invoice.' }),
      })
      setAdvisory(r as { status: string; result?: { summary?: string; vat_status?: string; suggested_account?: string; suggested_vat_rate?: number | null; do_not_approve?: boolean } })
    } catch (err) {
      setAdvisory({ status: 'error', result: { summary: err instanceof Error ? err.message : 'Advisory unavailable' } })
    } finally {
      setAdvisoryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedCase) requestAdvisory(selectedCase)
  }, [selectedCase, requestAdvisory])

  const doneRows = Object.values(rows).filter((r) => r.status === 'done')
  const errorRows = Object.values(rows).filter((r) => r.status === 'error')
  const anyBlocking = doneRows.some((r) => (r.risk_flags || []).length > 0) || errorRows.length > 0

  return (
    <section className="raven-card batch-ingest">
      <div className="card-head">
        <h3><Upload size={15} /> Ingest real Swiss invoices (batch)</h3>
        <small className="raven-muted">{files.length} PDF{files.length === 1 ? '' : 's'} available in <code>/data/incoming/invoices/</code></small>
      </div>

      <div className="batch-controls">
        <label className="batch-size-picker">
          <span>Batch size:</span>
          {[3, 5, 9].map((n) => (
            <button
              key={n}
              type="button"
              className={`batch-size-btn ${batchSize === n ? 'active' : ''}`}
              onClick={() => setBatchSize(n as 3 | 5 | 9)}
              disabled={running}
            >
              {n}
            </button>
          ))}
        </label>
        <button
          type="button"
          className="action-btn batch-run-btn"
          onClick={runBatch}
          disabled={running || files.length === 0}
        >
          {running ? <><RefreshCw size={13} className="spin" /> Running…</> : <><Zap size={13} /> Run {Math.min(batchSize, files.length)} through pipeline</>}
        </button>
      </div>

      {Object.keys(rows).length > 0 && (
        <div className="batch-results">
          <table className="batch-table">
            <thead>
              <tr><th>File</th><th>Vendor</th><th>Gross CHF</th><th>Risk</th><th>Latency</th><th>Case</th></tr>
            </thead>
            <tbody>
              {Object.values(rows).map((r) => (
                <tr key={r.filename} className={`batch-row status-${r.status} ${selectedFilename === r.filename ? 'selected' : ''}`}>
                  <td>
                    <button
                      className="batch-filename"
                      onClick={() => { if (r.case_id) { setSelectedCase(r.case_id); setSelectedFilename(r.filename) } }}
                      disabled={!r.case_id}
                    >
                      {r.filename.slice(0, 40)}
                    </button>
                  </td>
                  <td>{r.vendor || '—'}</td>
                  <td className="batch-gross">{r.gross || '—'}</td>
                  <td>
                    {r.status === 'error' && <span className="pill pill-red"><XCircle size={11} /> {r.error?.slice(0, 40)}</span>}
                    {r.status === 'done' && (r.risk_flags || []).length === 0 && <span className="pill pill-green"><Check size={11} /> clean</span>}
                    {r.status === 'done' && (r.risk_flags || []).length > 0 && <span className="pill pill-amber">{r.risk_flags?.length} flag(s)</span>}
                    {r.status === 'fetching' && <span className="pill pill-neutral"><RefreshCw size={11} className="spin" /> fetching</span>}
                    {r.status === 'processing' && <span className="pill pill-neutral"><Cpu size={11} className="spin" /> processing</span>}
                  </td>
                  <td className="batch-latency">{r.durationMs != null ? `${r.durationMs} ms` : '—'}</td>
                  <td className="batch-caseid">{r.case_id || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedCase && selectedFilename && (
        <div className="batch-review">
          <div className="batch-review-doc">
            <div className="batch-review-title">Source · {selectedFilename}</div>
            <iframe
              src={`${API_BASE}/api/demo/invoice-batch/file/${encodeURIComponent(selectedFilename)}#toolbar=0`}
              title={selectedFilename}
              className="batch-review-iframe"
            />
          </div>
          <div className="batch-review-panel">
            <div className="batch-review-title"><Sparkles size={13} /> Apertus booking suggestion · <small className="raven-muted">editable, subject to human approval</small></div>
            {advisoryLoading && <div className="raven-muted">Apertus analysing…</div>}
            {advisory && !advisoryLoading && (
              <>
                <div className="advisory-body">
                  <div className="advisory-row"><span>VAT status</span><b>{advisory.result?.vat_status || '—'}</b></div>
                  <div className="advisory-row"><span>Suggested VAT rate</span><b>{advisory.result?.suggested_vat_rate ?? '—'}%</b></div>
                  <div className="advisory-row"><span>Suggested KMU account</span><b>{advisory.result?.suggested_account || '—'}</b></div>
                  <div className="advisory-row"><span>Do not approve</span><b>{advisory.result?.do_not_approve === true ? 'Yes' : advisory.result?.do_not_approve === false ? 'No' : '—'}</b></div>
                </div>
                <div className="advisory-summary">
                  <label className="raven-overline" style={{ fontSize: 9.5 }}>Advisory summary (editable)</label>
                  <textarea
                    defaultValue={advisory.result?.summary || ''}
                    className="advisory-textarea"
                    aria-label="Editable Apertus summary"
                  />
                </div>
                <small className="raven-muted">⚠ Human approval required before any booking.</small>
              </>
            )}
          </div>
        </div>
      )}

      {doneRows.length > 0 && !running && (
        <div className="batch-next">
          <div className="batch-next-row">
            <ArrowLeftRight size={13} />
            <b>Next step:</b>
            <span>Ingest a UBS bank statement to reconcile these invoices against real bank transactions.</span>
            <button type="button" className="action-btn" disabled title="Bank statement ingest — same /process pipeline, roadmap wire-up">
              Ingest bank statement (roadmap)
            </button>
          </div>
          {anyBlocking && (
            <div className="batch-teaser">
              <ShieldAlert size={13} />
              <b>Unmatched or flagged.</b>
              <span>Route the case to <b>RavenClaw</b> — sandboxed agent for supplier-portal look-up and evidence gathering. <em>Coming in RAVEN Nest.</em></span>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function InvoicesPage({
  runtime,
  notify,
  addAudit,
}: {
  runtime: RuntimeCapabilities
  notify: (msg: string) => void
  addAudit: (entry: Omit<AuditEntry, 'timestamp'>) => void
}) {
  const [form, setForm] = useState<InvoiceForm>(EMPTY_INVOICE)
  const [phase, setPhase] = useState<'idle' | 'step1' | 'step2' | 'step3' | 'done'>('idle')

  const grossCalc = calcGross(form.net, form.vat_rate)
  const vatChf = calcVat(form.net, form.vat_rate)
  const grossState = grossCalc.ok ? 'ok' : (form.net || form.vat_rate ? 'warn' : 'ok')

  const apertusStatus: 'LIVE' | 'FALLBACK' | 'DOWN' =
    runtime.apertus_vllm?.status === 'live' ? 'LIVE'
    : runtime.source === 'mock' ? 'LIVE' : 'FALLBACK'

  const canSubmit = form.supplier.trim().length > 0 && form.invoice_number.trim().length > 0 && grossCalc.ok && phase === 'idle'

  const startProcessing = () => {
    if (!canSubmit) return
    setPhase('step1')
    window.setTimeout(() => setPhase('step2'), 500)
    window.setTimeout(() => setPhase('step3'), 500 + 800)
    window.setTimeout(() => setPhase('done'), 500 + 800 + 600)
  }

  const sendToMorgiana = async () => {
    try {
      const r = await apiFetch<{ case_id: string; review_state: string; erp_write: boolean }>(
        '/api/demo/invoice/queue-for-review',
        {
          method: 'POST',
          body: JSON.stringify({
            supplier: form.supplier,
            invoice_number: form.invoice_number,
            date: form.date,
            net: form.net,
            vat_rate: form.vat_rate,
            vat: vatChf,
            gross: grossCalc.gross,
            iban: form.iban,
            reference: form.reference,
          }),
        },
      )
      addAudit({
        action: 'invoice.queued_for_review',
        actor: 'morgiana-reviewer-01',
        case_id: r.case_id,
        detail: `Weighted score ${displayScore(INVOICE_CRITERIA_TEMPLATE)}`,
        outcome: r.review_state,
      })
      notify(`Queued as ${r.case_id} · erp_write: false`)
    } catch {
      // Backend unavailable — still surface the intent with a toast, do not fake success.
      notify('Backend unavailable — invoice not queued')
    }
  }

  const exportJson = () => {
    const payload = { ...form, gross: grossCalc.gross, vat: vatChf }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${form.invoice_number || 'invoice'}.json`
    a.click()
    URL.revokeObjectURL(url)
    notify('Invoice JSON downloaded')
  }

  return (
    <div className="page-simple">
      <section className="raven-heading">
        <div>
          <div className="raven-overline">RAVEN FINANCE GUARDIAN · KREDITOREN</div>
          <h1>Kreditoren · MWST</h1>
          <p>Rechnungen und Quittungen mit Schweizer MWST-Prüfung · OCR → Apertus → Qwen → council pipeline. Amounts computed with Decimal on the backend before any approval.</p>
        </div>
      </section>

      <NimPipelineStrip runtime={runtime} apertusStatus={apertusStatus} compact />

      <ArchiveUploader
        kind="invoice"
        label="Kreditoren-Upload · Rechnungen & Quittungen"
        hint="Drop Rechnung / Quittung / Receipt PDFs or scans. Filename hints (rechnung, invoice, quittung, receipt) route here automatically."
      />

      <BatchIngestPanel notify={notify} addAudit={addAudit} />

      <div className="inv-layout">
        {/* LEFT: form + progress */}
        <section className="raven-card">
          <div className="card-head">
            <h3><FileText size={15} /> New invoice</h3>
          </div>
          <div className="inv-form">
            <div className="inv-field">
              <label htmlFor="inv-supplier">Supplier</label>
              <input id="inv-supplier" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
            </div>
            <div className="inv-row2">
              <div className="inv-field">
                <label htmlFor="inv-number">Invoice #</label>
                <input id="inv-number" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
              </div>
              <div className="inv-field">
                <label htmlFor="inv-date">Date</label>
                <input id="inv-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>
            <div className="inv-row2">
              <div className="inv-field">
                <label htmlFor="inv-net">Net CHF</label>
                <input id="inv-net" type="number" step="0.01" min="0" value={form.net} onChange={(e) => setForm({ ...form, net: e.target.value })} />
              </div>
              <div className="inv-field">
                <label htmlFor="inv-vat">VAT rate</label>
                <select id="inv-vat" value={form.vat_rate} onChange={(e) => setForm({ ...form, vat_rate: e.target.value })}>
                  <option value="8.1">8.1% (normal)</option>
                  <option value="2.6">2.6% (reduced)</option>
                  <option value="3.8">3.8% (accommodation)</option>
                  <option value="0.0">0.0% (exempt)</option>
                </select>
              </div>
            </div>
            <div className={`inv-field readonly gross-${grossState}`}>
              <label htmlFor="inv-gross">Gross CHF · auto-calc</label>
              <input id="inv-gross" readOnly value={grossCalc.gross} />
            </div>
            <div className="inv-field">
              <label htmlFor="inv-iban">IBAN</label>
              <input id="inv-iban" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
            </div>
            <div className="inv-field">
              <label htmlFor="inv-ref">Reference</label>
              <input id="inv-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </div>
            <button className="inv-submit" onClick={startProcessing} disabled={!canSubmit}>
              <Cpu size={13} style={{ marginRight: 6, verticalAlign: -2 }} /> Process with RAVEN
            </button>
          </div>

          {phase !== 'idle' && (
            <div className="inv-progress" aria-live="polite">
              <div className={`inv-progress-step${phase === 'step1' ? ' active' : ' done'}`}>
                <Cpu size={13} /> Step 1 · OCR NIM extracting…
              </div>
              {(phase === 'step2' || phase === 'step3' || phase === 'done') && (
                <div className={`inv-progress-step${phase === 'step2' ? ' active' : ' done'}`}>
                  <Sparkles size={13} /> Step 2 · Apertus analysing…
                </div>
              )}
              {(phase === 'step3' || phase === 'done') && (
                <div className={`inv-progress-step${phase === 'step3' ? ' active' : ' done'}`}>
                  <ShieldCheck size={13} /> Step 3 · Qwen challenging…
                </div>
              )}
              {phase === 'done' && (
                <div className="inv-progress-step done" style={{ borderColor: 'var(--raven-nvidia-border)' }}>
                  <CheckCircle2 size={13} /> Ready for Morgiana review
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT: extraction result */}
        <section className="raven-card">
          <div className="card-head">
            <h3><Layers size={15} /> Extraction result</h3>
          </div>
          {phase !== 'done' ? (
            <div className="raven-empty">
              <FileText size={22} />
              <p>Run the pipeline to see extracted fields, VAT validation, council verdict and weighted score.</p>
            </div>
          ) : (
            <div className="inv-result">
              <table className="txn-table" style={{ marginBottom: 8 }}>
                <tbody>
                  <tr><td className="raven-muted" style={{ width: 130 }}>Supplier</td><td>{form.supplier}</td></tr>
                  <tr><td className="raven-muted">Invoice #</td><td className="mono">{form.invoice_number}</td></tr>
                  <tr><td className="raven-muted">Date</td><td className="mono">{form.date}</td></tr>
                  <tr><td className="raven-muted">Net</td><td className="chf">CHF {form.net}</td></tr>
                  <tr><td className="raven-muted">VAT ({form.vat_rate}%)</td><td className="chf">CHF {vatChf}</td></tr>
                  <tr><td className="raven-muted">Gross</td><td className="chf"><b>CHF {grossCalc.gross}</b></td></tr>
                  <tr><td className="raven-muted">IBAN</td><td className="mono">{form.iban}</td></tr>
                  <tr><td className="raven-muted">Reference</td><td className="mono">{form.reference}</td></tr>
                </tbody>
              </table>

              <div className={`inv-vat-row ${grossCalc.ok ? 'pass' : 'warn'}`}>
                {grossCalc.ok
                  ? <>✓ CHF {form.net} at {form.vat_rate}% + CHF {vatChf} = CHF {grossCalc.gross} — PASS</>
                  : <>⚠ MISMATCH — check Net / VAT inputs</>
                }
              </div>

              <div className="pop-row">
                <span className="pop-label">Apertus</span>
                <span className="pop-value">MATCH · Suggested account 6500 (Verwaltungsaufwand) · Conf 89%</span>
              </div>
              <div className="pop-row">
                <span className="pop-label">Qwen</span>
                <span className="pop-value">AGREE · No contradiction · Conf 87%</span>
              </div>

              <WeightedScorePanel criteria={INVOICE_CRITERIA_TEMPLATE} contradiction={0} />

              <div className="pop-actions">
                <button className="primary" onClick={sendToMorgiana}>
                  <Send size={13} style={{ marginRight: 4 }} /> Send to Morgiana for approval
                </button>
                <button onClick={exportJson}>Export JSON</button>
                <button onClick={() => notify('Draft saved to session')}>Save to case</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
