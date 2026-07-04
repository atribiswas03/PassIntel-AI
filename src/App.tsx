import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Shield, Cpu, Sparkles, RefreshCw, Copy, Check,
  AlertTriangle, Info, Lock, Download, Zap, Eye, EyeOff,
  BarChart3, Brain, ChevronRight, FlaskConical, Trash2, Search, Plus, FileText, Database
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { evaluatePassword } from './ai/evaluator';
import type { EvaluationResult } from './ai/evaluator';
import { generateAIPassword } from './ai/generator';
import { generateMutations } from './ai/mutator';
import type { MutationOption } from './ai/mutator';
import './App.css';

export interface SavedPassword {
  id: string;
  label: string;
  password: string;
  score: number;
  strengthLabel: string;
  createdAt: string;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
const strengthColor = (pct: number) =>
  pct >= 80 ? '#10b981' : pct >= 60 ? '#06b6d4' : pct >= 40 ? '#f59e0b' : '#ef4444';

const strengthLabel = (pct: number) =>
  pct >= 80 ? 'Very Strong' : pct >= 60 ? 'Strong' : pct >= 40 ? 'Moderate' : 'Weak';

const aiInsight = (r: EvaluationResult) => {
  if (r.strengthPercent >= 80) return `Excellent! Estimated crack time: ${r.timeToCrack} at 10B guesses/sec.`;
  if (r.strengthPercent >= 60) return `Good, but AI detected patterns. Use the Hardening Engine below.`;
  if (r.strengthPercent >= 40) return `Moderate — crackable in ${r.timeToCrack}. Common patterns detected.`;
  return `Weak! Crackable in ${r.timeToCrack}. Use the Hardening Engine immediately.`;
};

/* ─── ENTROPY RING ─────────────────────────────────────────────────── */
function EntropyRing({ bits, max = 120 }: { bits: number; max?: number }) {
  const r = 36, cx = 48, cy = 48, stroke = 8;
  const circumference = 2 * Math.PI * r;
  const color = bits >= 80 ? '#10b981' : bits >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={96} height={96} viewBox="0 0 96 96">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(bits / max, 1))}
        strokeLinecap="round"
        style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 0.7s ease, stroke 0.4s' }}
        filter={`drop-shadow(0 0 6px ${color})`}
      />
      <text x={cx} y={cy + 5} textAnchor="middle" fill={color}
        fontSize="15" fontWeight="800" fontFamily="Outfit,sans-serif">
        {Math.round(bits)}
      </text>
    </svg>
  );
}

/* ─── HEATMAP CHAR ─────────────────────────────────────────────────── */
function HeatmapChar({ char, prob, idx }: { char: string; prob: number; idx: number }) {
  const [show, setShow] = useState(false);
  const cls = prob >= 0.60 ? 'critical' : prob >= 0.30 ? 'high' : prob >= 0.10 ? 'medium' : 'low';
  const label = prob >= 0.60 ? 'Very Weak' : prob >= 0.30 ? 'Weak' : prob >= 0.10 ? 'Moderate' : 'Strong';
  return (
    <div className={`heatmap-char ${cls}`}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}
      style={{ animationDelay: `${idx * 0.04}s` }}>
      {char === ' ' ? '·' : char}
      <span className="heatmap-char-sub">{Math.round(prob * 100)}%</span>
      {show && (
        <div className="char-tooltip" style={{ whiteSpace: 'pre-line' }}>
          {`Position ${idx + 1}: "${char}"\nPredictability: ${(prob * 100).toFixed(1)}%\nRating: ${label}`}
        </div>
      )}
    </div>
  );
}

/* ─── SUGGESTION CARD ──────────────────────────────────────────────── */
function SuggestionCard({ opt }: { opt: MutationOption }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(opt.mutatedPassword).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="suggestion-card">
      <div className="suggestion-password">
        <span style={{ wordBreak: 'break-all', flex: 1 }}>{opt.mutatedPassword}</span>
        <button className={`icon-btn ${copied ? 'success' : ''}`} onClick={handleCopy} title="Copy">
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      <div className="suggestion-desc">{opt.explanation}</div>
      <div className="tag-row">
        <span className="tag tag-green">+{opt.securityImprovement}% strength</span>
        <span className="tag tag-cyan">{opt.strategy}</span>
        <span className="tag" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
          Memory: {opt.memorabilityScore}%
        </span>
      </div>
    </div>
  );
}

/* ─── MAIN APP ─────────────────────────────────────────────────────── */
export default function App() {
  const [tab, setTab] = useState<'check' | 'generate' | 'vault'>('check');
  const [password, setPassword] = useState('');
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [mutations, setMutations] = useState<MutationOption[]>([]);
  const [genPwd, setGenPwd] = useState('');
  const [genResult, setGenResult] = useState<EvaluationResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [length, setLength] = useState(18);
  const [temperature, setTemperature] = useState(0.7);
  const [useUpper, setUseUpper] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSpecial, setUseSpecial] = useState(true);
  const [pwaPrompt, setPwaPrompt] = useState<any>(null);
  const debounceRef = useRef<any>(null);

  // Secure Vault state
  const [savedPasswords, setSavedPasswords] = useState<SavedPassword[]>(() => {
    try {
      const stored = localStorage.getItem('passintel_saved_passwords');
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.error('Failed to parse saved passwords', e);
      return [];
    }
  });
  
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [passwordToSave, setPasswordToSave] = useState('');
  const [scoreToSave, setScoreToSave] = useState(0);
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, boolean>>({});
  const [vaultSearch, setVaultSearch] = useState('');

  // Persist saved passwords
  useEffect(() => {
    localStorage.setItem('passintel_saved_passwords', JSON.stringify(savedPasswords));
  }, [savedPasswords]);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setPwaPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!password) { setResult(null); setMutations([]); return; }
    debounceRef.current = setTimeout(() => {
      setResult(evaluatePassword(password));
      setMutations([]);
    }, 180);
  }, [password]);

  const handleGenerate = useCallback(() => {
    const pwd = generateAIPassword({ length, temperature, includeUpper: useUpper, includeDigits: useDigits, includeSpecial: useSpecial });
    setGenPwd(pwd);
    setGenResult(evaluatePassword(pwd));
    setCopied(false);
  }, [length, temperature, useUpper, useDigits, useSpecial]);

  useEffect(() => { handleGenerate(); }, [handleGenerate]);

  const handleCopy = (p: string) => {
    navigator.clipboard.writeText(p).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleHarden = () => {
    if (!password) return;
    setMutations(generateMutations(password));
  };

  const triggerSave = (pwd: string, score: number) => {
    setPasswordToSave(pwd);
    setScoreToSave(score);
    setSaveLabel('');
    setSaveModalOpen(true);
  };

  const confirmSave = () => {
    if (!saveLabel.trim() || !passwordToSave) return;
    const newSaved: SavedPassword = {
      id: crypto.randomUUID(),
      label: saveLabel.trim(),
      password: passwordToSave,
      score: scoreToSave,
      strengthLabel: strengthLabel(scoreToSave),
      createdAt: new Date().toISOString()
    };
    setSavedPasswords(prev => [newSaved, ...prev]);
    setSaveModalOpen(false);
    setSaveLabel('');
  };

  const deletePassword = (id: string) => {
    if (confirm('Are you sure you want to delete this saved password?')) {
      setSavedPasswords(prev => prev.filter(p => p.id !== id));
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedPasswords(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    
    // Add custom styling & layout to PDF
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(139, 92, 246); // Purple color theme
    doc.text("PassIntel AI - Secure Vault Report", 14, 20);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 26);
    
    // Line separator
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 30, 196, 30);
    
    // Metadata/Summary metrics
    const total = savedPasswords.length;
    const avgScore = total > 0 ? Math.round(savedPasswords.reduce((acc, curr) => acc + curr.score, 0) / total) : 0;
    
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Vault Summary", 14, 42);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(51, 65, 85);
    doc.text(`Total Saved Passwords: ${total}`, 14, 49);
    doc.text(`Average Strength Score: ${avgScore}/100`, 14, 55);
    
    // Warning banner about print security
    doc.setFillColor(254, 242, 242);
    doc.rect(14, 62, 182, 12, "F");
    doc.setTextColor(220, 38, 38);
    doc.setFont("helvetica", "bold");
    doc.text("SECURITY NOTICE: Keep this printed document secure. It contains plain-text credentials.", 18, 69);

    // Draw a list/table of passwords
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Saved Items", 14, 85);
    
    let y = 93;
    
    // Headers
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(71, 85, 105);
    doc.text("Label / Service", 14, y);
    doc.text("Password", 60, y);
    doc.text("Strength Score", 140, y);
    doc.text("Date Saved", 170, y);
    
    doc.setDrawColor(148, 163, 184);
    doc.line(14, y + 2, 196, y + 2);
    y += 8;
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(15, 23, 42);
    
    savedPasswords.forEach((item) => {
      doc.setFont("courier", "normal");
      const splitPassword = doc.splitTextToSize(item.password, 75);
      const lineCount = splitPassword.length;
      const rowHeight = Math.max(8, lineCount * 5 + 3);

      if (y + rowHeight > 280) {
        doc.addPage();
        y = 20;
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(15, 23, 42);
      doc.text(item.label, 14, y);
      
      doc.setFont("courier", "normal");
      doc.setTextColor(30, 41, 59);
      doc.text(splitPassword, 60, y);
      
      doc.setFont("helvetica", "normal");
      doc.setTextColor(71, 85, 105);
      doc.text(`${item.score}/100`, 140, y);
      
      const dateStr = new Date(item.createdAt).toLocaleDateString();
      doc.text(dateStr, 170, y);
      
      doc.setDrawColor(241, 245, 249);
      doc.line(14, y + rowHeight - 6, 196, y + rowHeight - 6);
      y += rowHeight;
    });
    
    doc.save(`passintel_vault_export_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const installPwa = () => {
    if (!pwaPrompt) return;
    pwaPrompt.prompt();
    pwaPrompt.userChoice.then(() => setPwaPrompt(null));
  };

  return (
    <>
      {/* Background */}
      <div className="bg-canvas">
        <div className="bg-orb bg-orb-1" />
        <div className="bg-orb bg-orb-2" />
        <div className="bg-orb bg-orb-3" />
        <div className="bg-grid" />
      </div>

      {/* Navbar */}
      <nav>
        <div className="page-wrapper">
          <div className="nav-inner">
            <div className="nav-logo">
              <img src="/Logo.png" alt="PassIntel AI Logo" style={{ height: '28px', width: 'auto', display: 'block', borderRadius: '6px' }} />
              PassIntel AI
            </div>
            <div className="nav-status">AI Engine Active</div>
          </div>
        </div>
      </nav>

      <div className="page-wrapper">

        {/* Hero */}
        <div className="hero">
          <div className="hero-eyebrow"><Brain size={13} /> AI-Powered Security Intelligence</div>
          <h1 className="hero-title">
            Stop Using Weak Passwords.
            <span className="gradient-text">AI Will Harden Them.</span>
          </h1>
          <p className="hero-subtitle">
            Our neural engine analyzes every character for predictability, generates
            cryptographically superior passwords, and mutates weak ones into unbreakable secrets.
          </p>
          <div className="mode-toggle">
            <button className={`mode-btn ${tab === 'check' ? 'active' : ''}`} onClick={() => setTab('check')} id="tab-check">
              <Eye size={16} /> Analyze &amp; Harden
            </button>
            <button className={`mode-btn ${tab === 'generate' ? 'active' : ''}`} onClick={() => setTab('generate')} id="tab-generate">
              <Sparkles size={16} /> AI Generator
            </button>
            <button className={`mode-btn ${tab === 'vault' ? 'active' : ''}`} onClick={() => setTab('vault')} id="tab-vault">
              <Lock size={16} /> Secure Vault ({savedPasswords.length})
            </button>
          </div>
          <div className="stats-strip">
            {[
              { value: 'N-gram', label: 'Language Model' },
              { value: '128-bit', label: 'Max Entropy' },
              { value: '6', label: 'Hardening Strategies' },
              { value: '100%', label: 'Client-Side Privacy' },
            ].map(s => (
              <div className="stat-item" key={s.label}>
                <div className="stat-value">{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* PWA Banner */}
        {pwaPrompt && (
          <div className="pwa-banner">
            <Download size={22} style={{ color: 'var(--purple-light)', flexShrink: 0 }} />
            <div className="pwa-banner-text">
              <strong>Install PassIntel AI</strong>
              Use offline, any time — no server, no tracking.
            </div>
            <button className="pwa-install-btn" onClick={installPwa}>
              <Download size={15} /> Install App
            </button>
          </div>
        )}

        {/* ════════════════════════════════════════════
            ANALYZE TAB
        ════════════════════════════════════════════ */}
        {tab === 'check' && (
          <div className="section-reveal">

            {/* Row 1: 2-col — Analyzer | Security Metrics */}
            <div className="main-grid" style={{ marginBottom: 24 }}>

              {/* LEFT — Password Analyzer */}
              <div className="card">
                <div className="card-title">
                  <div className="card-title-icon purple"><Eye size={18} /></div>
                  Password Analyzer
                </div>

                <div className="mb-6">
                  <div className="field-label">
                    Enter your password
                    <span className="field-hint"><Lock size={12} /> Analyzed locally — never sent</span>
                  </div>
                  <div className="input-wrapper">
                    <input id="password-input" className="text-input" type="text"
                      placeholder="Type or paste your password…"
                      value={password} onChange={e => setPassword(e.target.value)}
                      autoComplete="off" spellCheck={false} />
                    {password && (
                      <button className="input-action"
                        onClick={() => { setPassword(''); setResult(null); setMutations([]); }}>✕</button>
                    )}
                  </div>
                </div>

                {result ? (
                  <>
                    <div className="section-label"><BarChart3 size={13} /> Character Predictability Heatmap</div>
                    <div className="heatmap-wrap">
                      {result.charEvaluations.map((c, i) => (
                        <HeatmapChar key={i} char={c.char} prob={c.probability} idx={i} />
                      ))}
                    </div>
                    <div className="legend mt-4">
                      {[
                        { color: 'rgba(239,68,68,0.7)', label: 'Critical (≥60%)' },
                        { color: 'rgba(249,115,22,0.7)', label: 'Weak (≥30%)' },
                        { color: 'rgba(245,158,11,0.7)', label: 'Moderate (≥10%)' },
                        { color: 'rgba(16,185,129,0.7)', label: 'Strong (<10%)' },
                      ].map(l => (
                        <span className="legend-item" key={l.label}>
                          <span className="legend-dot" style={{ background: l.color }} /> {l.label}
                        </span>
                      ))}
                    </div>
                    <div className="strength-bar-wrap mt-6">
                      <div className="strength-bar-label">
                        <span>Overall Strength</span>
                        <span style={{ color: strengthColor(result.strengthPercent), fontWeight: 700 }}>
                          {strengthLabel(result.strengthPercent)} — {result.strengthPercent}/100
                        </span>
                      </div>
                      <div className="strength-bar-track">
                        <div className="strength-bar-fill" style={{
                          width: `${result.strengthPercent}%`,
                          background: strengthColor(result.strengthPercent),
                        }} />
                      </div>
                    </div>
                    <button className="harden-btn mt-4" style={{ borderColor: 'var(--purple)', background: 'rgba(139,92,246,0.08)', color: 'var(--purple-light)' }} onClick={() => triggerSave(password, result.strengthPercent)}>
                      <Lock size={14} style={{ marginRight: 8 }} /> Save to Secure Vault
                    </button>
                  </>
                ) : (
                  <div className="empty-state">
                    <Eye size={36} style={{ margin: '0 auto 16px', opacity: 0.2 }} />
                    <p>Type a password above to see the AI analysis in real time</p>
                  </div>
                )}
              </div>

              {/* RIGHT — Security Metrics */}
              {result ? (
                <div className="card">
                  <div className="card-title">
                    <div className="card-title-icon cyan"><BarChart3 size={18} /></div>
                    Security Metrics
                  </div>
                  <div className="entropy-ring-wrap">
                    <EntropyRing bits={result.totalEntropy} />
                    <div className="entropy-ring-info">
                      <div className="entropy-ring-label">Shannon Entropy</div>
                      <div className="entropy-ring-value" style={{ color: strengthColor(result.strengthPercent) }}>
                        {result.totalEntropy.toFixed(1)} bits
                      </div>
                      <div className="entropy-ring-sub">
                        {result.totalEntropy >= 80 ? 'Practically uncrackable'
                          : result.totalEntropy >= 50 ? 'Resistant to most attacks'
                            : 'Vulnerable to modern cracking'}
                      </div>
                    </div>
                  </div>
                  <div className="metrics-grid">
                    <div className="metric-tile">
                      <div className="metric-title">Length</div>
                      <div className="metric-number"
                        style={{ color: result.charEvaluations.length >= 12 ? 'var(--green)' : 'var(--orange)' }}>
                        {result.charEvaluations.length}
                      </div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-title">Crack Time</div>
                      <div className="metric-number"
                        style={{ fontSize: '0.9rem', color: 'var(--cyan)', lineHeight: 1.2, paddingTop: 4 }}>
                        {result.timeToCrack}
                      </div>
                    </div>
                    <div className="metric-tile">
                      <div className="metric-title">Score</div>
                      <div className="metric-number" style={{ color: strengthColor(result.strengthPercent) }}>
                        {result.strengthPercent}
                      </div>
                    </div>
                  </div>
                  <div className="info-strip">
                    <Info size={16} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 1 }} />
                    <span>{aiInsight(result)}</span>
                  </div>
                </div>
              ) : (
                <div className="card" style={{ opacity: 0.35 }}>
                  <div className="card-title">
                    <div className="card-title-icon cyan"><BarChart3 size={18} /></div>
                    Security Metrics
                  </div>
                  <div className="empty-state">
                    <BarChart3 size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <p>Metrics will appear once you enter a password</p>
                  </div>
                </div>
              )}
            </div>

            {/* Row 2: FULL-WIDTH — Smart AI Hardening Engine */}
            <div className="card">
              <div className="card-title">
                <div className="card-title-icon green"><Zap size={18} /></div>
                Smart AI Hardening Engine
                {result && (
                  <button className="harden-btn-inline" onClick={handleHarden} id="btn-harden">
                    <Zap size={15} />
                    {mutations.length > 0 ? 'Regenerate Variants' : 'Generate Hardened Variants'}
                  </button>
                )}
              </div>

              {!result ? (
                <div className="hardening-empty">
                  <div className="hardening-empty-icon"><Zap size={28} /></div>
                  <div className="hardening-empty-text">
                    <strong>Enter a password above</strong> to unlock the AI Hardening Engine.
                    It analyzes weak spots and generates up to 6 strengthened, still-memorable variants.
                  </div>
                </div>
              ) : mutations.length > 0 ? (
                <>
                  <div className="section-label" style={{ marginBottom: 20 }}>
                    <ChevronRight size={13} /> {mutations.length} AI Recommendations — hover a card, click to copy
                  </div>
                  <div className="suggestions-grid-wide">
                    {mutations.slice(0, 6).map((m, i) => (
                      <SuggestionCard key={i} opt={m} />
                    ))}
                  </div>
                </>
              ) : (
                <div className="hardening-idle">
                  <p className="hardening-desc">
                    The AI identifies the most predictable character positions in your password and applies
                    6 distinct mutation strategies — leet-speak, case alternation, entropy injection, selective
                    capitalization, entropy anchoring, and compound mutations — to produce stronger alternatives.
                  </p>
                  <div className="info-strip mt-4">
                    <Info size={15} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
                    <span>Click <strong>Generate Hardened Variants</strong> in the card header above to run the AI engine.</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            GENERATE TAB
        ════════════════════════════════════════════ */}
        {tab === 'generate' && (
          <div className="section-reveal">
            <div className="main-grid">

              {/* Controls */}
              <div className="card">
                <div className="card-title">
                  <div className="card-title-icon purple"><Cpu size={18} /></div>
                  Generator Controls
                </div>

                <div className="slider-group">
                  <div className="field-label">
                    Password Length
                    <span className="field-hint" style={{ color: 'var(--cyan-light)', fontWeight: 700 }}>{length} chars</span>
                  </div>
                  <input id="slider-length" type="range" min={8} max={64}
                    value={length} onChange={e => setLength(+e.target.value)} className="slider-track" />
                  <div className="slider-hint">
                    <strong>{length < 12 ? 'Minimal' : length < 20 ? 'Recommended' : 'Maximum'}</strong>
                    {' — '}shorter passwords are easier to crack
                  </div>
                </div>

                <div className="slider-group">
                  <div className="field-label">
                    AI Randomness (Temperature)
                    <span className="field-hint" style={{ color: 'var(--purple-light)', fontWeight: 700 }}>{temperature.toFixed(2)}</span>
                  </div>
                  <input id="slider-temp" type="range" min={0.1} max={2.0} step={0.05}
                    value={temperature} onChange={e => setTemperature(+e.target.value)} className="slider-track" />
                  <div className="slider-hint">
                    <strong>{temperature < 0.5 ? 'Structured' : temperature < 1.2 ? 'Balanced' : 'Chaotic'}</strong>
                    {' — '}low = structured patterns, high = maximum entropy
                  </div>
                </div>

                <div className="field-label" style={{ marginBottom: 14 }}>Include Character Types</div>
                <div className="checkbox-row">
                  <label className="checkbox-chip" htmlFor="chk-lower">
                    <input id="chk-lower" type="checkbox" checked={true} disabled />
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>abc</span>
                    Lowercase
                  </label>
                  <label className="checkbox-chip" htmlFor="chk-upper">
                    <input id="chk-upper" type="checkbox" checked={useUpper} onChange={e => setUseUpper(e.target.checked)} />
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>ABC</span>
                    Uppercase
                  </label>
                  <label className="checkbox-chip" htmlFor="chk-digits">
                    <input id="chk-digits" type="checkbox" checked={useDigits} onChange={e => setUseDigits(e.target.checked)} />
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>123</span>
                    Digits
                  </label>
                  <label className="checkbox-chip" htmlFor="chk-special">
                    <input id="chk-special" type="checkbox" checked={useSpecial} onChange={e => setUseSpecial(e.target.checked)} />
                    <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>!@#</span>
                    Symbols
                  </label>
                </div>

                <button className="gen-btn" onClick={handleGenerate} id="btn-generate">
                  <Sparkles size={18} /> Generate with AI <RefreshCw size={14} />
                </button>

                <div className="tip-box">
                  <Info size={15} style={{ color: 'var(--cyan)', flexShrink: 0, marginTop: 2 }} />
                  <span>
                    The AI engine uses <strong>temperature-scaled character sampling</strong> — a technique
                    borrowed from large language models — to produce passwords that balance entropy and memorability.
                  </span>
                </div>
              </div>

              {/* Result */}
              <div className="card">
                <div className="card-title">
                  <div className="card-title-icon cyan"><Sparkles size={18} /></div>
                  Generated Password
                </div>

                <div className="generated-display">
                  <span className="generated-text">{genPwd || '—'}</span>
                  <button className={`icon-btn ${copied ? 'success' : ''}`} onClick={() => handleCopy(genPwd)} title="Copy">
                    {copied ? <Check size={18} /> : <Copy size={18} />}
                  </button>
                  <button className="icon-btn" onClick={handleGenerate} title="Regenerate">
                    <RefreshCw size={18} />
                  </button>
                </div>

                {genResult && (
                  <>
                    <div className="entropy-ring-wrap">
                      <EntropyRing bits={genResult.totalEntropy} />
                      <div className="entropy-ring-info">
                        <div className="entropy-ring-label">Entropy Score</div>
                        <div className="entropy-ring-value" style={{ color: strengthColor(genResult.strengthPercent) }}>
                          {genResult.totalEntropy.toFixed(1)} bits
                        </div>
                        <div className="entropy-ring-sub">{strengthLabel(genResult.strengthPercent)}</div>
                      </div>
                    </div>
                    <div className="metrics-grid">
                      <div className="metric-tile">
                        <div className="metric-title">Length</div>
                        <div className="metric-number" style={{ color: 'var(--green)' }}>
                          {genResult.charEvaluations.length}
                        </div>
                      </div>
                      <div className="metric-tile">
                        <div className="metric-title">Crack Time</div>
                        <div className="metric-number" style={{ fontSize: '0.9rem', color: 'var(--cyan)', lineHeight: 1.2 }}>
                          {genResult.timeToCrack}
                        </div>
                      </div>
                      <div className="metric-tile">
                        <div className="metric-title">Score</div>
                        <div className="metric-number" style={{ color: strengthColor(genResult.strengthPercent) }}>
                          {genResult.strengthPercent}
                        </div>
                      </div>
                    </div>
                    <div className="info-strip">
                      <Info size={15} style={{ color: 'var(--cyan)', flexShrink: 0 }} />
                      <span>{aiInsight(genResult)}</span>
                    </div>
                    <button className="harden-btn mt-4" style={{ borderColor: 'var(--purple)', background: 'rgba(139,92,246,0.08)', color: 'var(--purple-light)' }} onClick={() => triggerSave(genPwd, genResult.strengthPercent)}>
                      <Lock size={14} style={{ marginRight: 8 }} /> Save to Secure Vault
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            SECURE VAULT TAB
        ════════════════════════════════════════════ */}
        {tab === 'vault' && (
          <div className="section-reveal">
            <div className="card">
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div className="card-title-icon purple"><Database size={18} /></div>
                  Secure Local Vault
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  {savedPasswords.length > 0 && (
                    <button className="harden-btn-inline" onClick={handleExportPDF} style={{ borderColor: 'var(--purple-light)', background: 'rgba(139,92,246,0.1)', color: 'var(--purple-light)' }}>
                      <FileText size={14} style={{ marginRight: 6 }} /> Export Vault (PDF)
                    </button>
                  )}
                </div>
              </div>

              <div className="vault-actions" style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
                <div className="search-wrapper" style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    placeholder="Search saved passwords by label..."
                    value={vaultSearch}
                    onChange={e => setVaultSearch(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px 12px 42px',
                      background: 'rgba(0, 0, 0, 0.3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontSize: '0.9rem',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              {savedPasswords.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 0' }}>
                  <Database size={48} style={{ margin: '0 auto 16px', opacity: 0.2, color: 'var(--purple-light)' }} />
                  <p>Your local vault is empty.</p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Generate a password or enter one in the analyzer, then click "Save to Secure Vault" to list it here.
                  </p>
                </div>
              ) : (
                <div className="vault-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {savedPasswords
                    .filter(p => p.label.toLowerCase().includes(vaultSearch.toLowerCase()))
                    .map(p => {
                      const revealed = !!revealedPasswords[p.id];
                      return (
                        <div key={p.id} className="vault-item" style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '16px',
                          padding: '16px 20px',
                          background: 'rgba(255, 255, 255, 0.015)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-md)',
                          flexWrap: 'wrap',
                          transition: 'all 0.2s ease'
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '150px' }}>
                            <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{p.label}</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Saved {new Date(p.createdAt).toLocaleDateString()}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 2, minWidth: '240px', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                            <span style={{
                              fontFamily: 'var(--mono)',
                              fontSize: '1rem',
                              letterSpacing: revealed ? 'normal' : '0.15em',
                              wordBreak: 'break-all',
                              flex: 1,
                              color: revealed ? 'var(--text-primary)' : 'var(--text-muted)'
                            }}>
                              {revealed ? p.password : '••••••••••••••••'}
                            </span>
                            <button
                              className="icon-btn"
                              onClick={() => toggleReveal(p.id)}
                              title={revealed ? "Hide Password" : "Show Password"}
                              style={{ padding: '4px' }}
                            >
                              {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => {
                                navigator.clipboard.writeText(p.password).catch(() => {});
                                alert('Password copied to clipboard!');
                              }}
                              title="Copy Password"
                              style={{ padding: '4px' }}
                            >
                              <Copy size={16} />
                            </button>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'flex-end', minWidth: '120px' }}>
                            <span className="tag" style={{
                              background: `${strengthColor(p.score)}15`,
                              color: strengthColor(p.score),
                              borderColor: `${strengthColor(p.score)}30`,
                              border: '1px solid',
                              fontWeight: 700
                            }}>
                              {p.score}/100
                            </span>
                            <button
                              className="icon-btn"
                              onClick={() => deletePassword(p.id)}
                              title="Delete Item"
                              style={{ color: 'var(--red)', padding: '6px' }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* HOW IT WORKS */}
        <div className="mt-8 section-reveal">
          <div className="section-label"><FlaskConical size={13} /> How It Works</div>
          <div className="steps-grid">
            {[
              { n: '01', title: 'N-gram Language Model', body: 'A statistical model trained on real-world password patterns computes character-by-character predictability. High predictability = easy to crack.' },
              { n: '02', title: 'Shannon Entropy Score', body: 'Each password is scored using information theory. More bits = more randomness. 80+ bits is considered safe against all known attacks.' },
              { n: '03', title: 'Temperature Sampling', body: 'The generator uses temperature scaling from LLM research — lower = structured, memorable; higher = maximum chaos and entropy.' },
              { n: '04', title: 'Smart Mutation Engine', body: 'Weak character positions get targeted mutations: leet-speak, case alternation, entropy injection, and structural reordering.' },
              { n: '05', title: 'Real-World Threat Modeling', body: '94% of data breaches involve stolen credentials. Every password is tested against common attack patterns from real breach datasets.' },
              { n: '06', title: '100% Private by Design', body: 'All AI runs inside your browser. No password, no data, ever leaves your device. Zero telemetry, zero tracking.' },
            ].map(({ n, title, body }) => (
              <div className="step-card" key={n}>
                <div className="step-number">Step {n}</div>
                <div className="step-title">{title}</div>
                <div className="step-body">{body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* WHY IT MATTERS */}
        <div className="mt-8 section-reveal">
          <div className="section-label"><AlertTriangle size={13} /> Why Password Security Matters</div>
          <div className="why-grid">
            {[
              {
                icon: <AlertTriangle size={18} style={{ color: 'var(--red)' }} />,
                title: 'The Real Threat Landscape',
                body: <>In 2023, over <strong>8 billion passwords</strong> were exposed in data breaches. Attackers use GPU clusters testing <code>100 billion/sec</code>. A 6-character lowercase password falls in under a second.</>
              },
              {
                icon: <Brain size={18} style={{ color: 'var(--purple-light)' }} />,
                title: 'Why AI Changes Everything',
                body: <>Traditional strength meters just count character types. Our AI models the statistical structure attackers exploit — it knows that <code>Password123!</code> scores low despite having all character classes.</>
              },
              {
                icon: <Shield size={18} style={{ color: 'var(--green)' }} />,
                title: 'What Makes a Password Uncrackable',
                body: <>Length matters more than complexity. A 20-character password from a small charset beats a 10-character one with all symbols. Our generator targets <code>80+ bits</code> of entropy by design.</>
              },
              {
                icon: <Lock size={18} style={{ color: 'var(--cyan-light)' }} />,
                title: 'Best Practices We Encode',
                body: <>NIST SP 800-63B recommends passwords of <code>15+ characters</code>, avoiding common words and patterns. Our AI hardening engine automatically encodes these guidelines into every suggestion.</>
              },
            ].map(({ icon, title, body }) => (
              <div className="why-card" key={title}>
                <div className="why-card-title">{icon} {title}</div>
                <div className="why-card-body">{body}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Save to Vault Modal Overlay */}
        {saveModalOpen && (
          <div className="save-modal-overlay" style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 4, 8, 0.8)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fade-in 0.2s ease'
          }}>
            <div className="card" style={{
              width: '95%',
              maxWidth: '440px',
              padding: '28px',
              boxShadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(139,92,246,0.2)'
            }}>
              <div className="card-title" style={{ borderBottom: 'none', marginBottom: '16px', paddingBottom: 0 }}>
                <div className="card-title-icon purple"><Database size={18} /></div>
                Save to Vault
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5 }}>
                Give this password a label or service name (e.g. Google, GitHub, Work PC) to save it locally.
              </p>
              <div style={{ marginBottom: '20px' }}>
                <label className="field-label">Label / Service Name</label>
                <input
                  type="text"
                  placeholder="e.g. My GitHub Account"
                  value={saveLabel}
                  onChange={e => setSaveLabel(e.target.value)}
                  className="text-input"
                  style={{ fontSize: '1rem', padding: '12px 14px' }}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') confirmSave();
                    if (e.key === 'Escape') setSaveModalOpen(false);
                  }}
                />
              </div>
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px 16px', borderRadius: '8px', marginBottom: '24px', border: '1px solid rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '4px' }}>Password</div>
                <div style={{ fontFamily: 'var(--mono)', wordBreak: 'break-all', fontSize: '0.95rem' }}>{passwordToSave}</div>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button className="harden-btn-inline" onClick={() => setSaveModalOpen(false)} style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'transparent' }}>
                  Cancel
                </button>
                <button className="pwa-install-btn" onClick={confirmSave} disabled={!saveLabel.trim()} style={{ opacity: saveLabel.trim() ? 1 : 0.5, cursor: saveLabel.trim() ? 'pointer' : 'not-allowed' }}>
                  <Plus size={14} style={{ marginRight: 6 }} /> Save Password
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer>
          <p>
            <strong style={{ color: 'var(--text-secondary)' }}>PassIntel AI</strong>
            {' '}— Open source · Runs 100% in your browser · No data collection
          </p>
          <p style={{ marginTop: 8 }}>
            Built with TypeScript · Vite · React · AI/ML techniques inspired by modern NLP research
          </p>
        </footer>
      </div>
    </>
  );
}
