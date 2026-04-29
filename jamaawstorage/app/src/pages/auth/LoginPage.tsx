import { useState, useCallback, useEffect, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import logoJamaaw from '../../assets/logojamaaw.png'

// ─── Shelf Icon SVG (post-login success state) ───────────────────────────────

function ShelfIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="2" rx=".8" fill="currentColor" />
      <rect x="3" y="10" width="18" height="2" rx=".8" fill="currentColor" />
      <rect x="3" y="17" width="18" height="2" rx=".8" fill="currentColor" />
      <rect x="3" y="3" width="1.8" height="16" rx=".5" fill="currentColor" opacity=".5" />
      <rect x="19.2" y="3" width="1.8" height="16" rx=".5" fill="currentColor" opacity=".5" />
      <rect x="7" y="6" width="4" height="3.5" rx=".5" fill="currentColor" opacity=".65" />
      <rect x="13" y="6" width="5" height="3.5" rx=".5" fill="currentColor" opacity=".65" />
      <rect x="6" y="13" width="5" height="3.5" rx=".5" fill="currentColor" opacity=".65" />
      <rect x="13" y="13" width="4" height="3.5" rx=".5" fill="currentColor" opacity=".65" />
    </svg>
  )
}

// ─── Floating Boxes (ambient background animation) ───────────────────────────

const BOX_DATA: Array<{
  s: number; x: string; y: string; side: 'l' | 'r' | 'tl' | 'br'
  delay: number; dur: number; op: number
}> = [
  { s: 48, x: '5%',  y: '10%',  side: 'tl', delay: 0,   dur: 8,   op: .06 },
  { s: 32, x: '88%', y: '12%',  side: 'r',  delay: 1.5, dur: 9,   op: .05 },
  { s: 64, x: '3%',  y: '75%',  side: 'l',  delay: .8,  dur: 7.5, op: .055 },
  { s: 40, x: '90%', y: '72%',  side: 'br', delay: 2.2, dur: 6.5, op: .055 },
  { s: 24, x: '12%', y: '42%',  side: 'l',  delay: 3,   dur: 10,  op: .04 },
  { s: 28, x: '92%', y: '48%',  side: 'r',  delay: 1.8, dur: 8.5, op: .042 },
  { s: 44, x: '8%',  y: '58%',  side: 'l',  delay: .4,  dur: 11,  op: .035 },
  { s: 20, x: '85%', y: '30%',  side: 'r',  delay: 3.5, dur: 7,   op: .04 },
  { s: 36, x: '15%', y: '22%',  side: 'tl', delay: 2,   dur: 9.5, op: .038 },
  { s: 30, x: '78%', y: '85%',  side: 'br', delay: 1,   dur: 8,   op: .045 },
]

function FloatingBoxes() {
  return (
    <div aria-hidden="true" className="login-boxes-container">
      {BOX_DATA.map((b, i) => (
        <svg
          key={i}
          width={b.s}
          height={b.s}
          viewBox="0 0 48 48"
          fill="none"
          className="login-floating-box"
          style={{
            left: b.x,
            top: b.y,
            opacity: b.op,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
          }}
        >
          <rect x="6" y="18" width="36" height="24" rx="2.5" stroke="#f97316" strokeWidth="2" />
          <path d="M4 18L24 8L44 18" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" />
          <line x1="24" y1="18" x2="24" y2="42" stroke="#f97316" strokeWidth="1" opacity=".4" />
        </svg>
      ))}
    </div>
  )
}

// ─── Password Visibility Toggle ──────────────────────────────────────────────

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// ─── LoginPage ────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'loading' | 'success'

export function LoginPage() {
  const { signIn, user, loading: authLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const formRef = useRef<HTMLFormElement>(null)

  // Shake animation on error
  const [shake, setShake] = useState(false)
  useEffect(() => {
    if (error) {
      requestAnimationFrame(() => {
        setShake(true)
      })
      const t = setTimeout(() => setShake(false), 500)
      return () => clearTimeout(t)
    }
  }, [error])

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (phase !== 'idle') return

      setError(null)
      setPhase('loading')

      const { error: signInError } = await signIn(email.trim(), password)

      if (signInError) {
        setError(signInError)
        setPhase('idle')
      } else {
        // Success — the AuthContext onAuthStateChange will set `user`,
        // which triggers the redirect guard below
        setPhase('success')
      }
    },
    [signIn, email, password, phase]
  )

  // ── Fallback: if success state lingers >6s, something went wrong ────────────
  useEffect(() => {
    if (phase === 'success') {
      const t = setTimeout(() => {
        // Safety valve: if we're still on this page after 6s, reset
        setPhase('idle')
        setError('Tempo esgotado. Tente novamente.')
      }, 6000)
      return () => clearTimeout(t)
    }
  }, [phase])

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="login-screen">
        <div className="login-initial-loader" />
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const isDisabled = phase !== 'idle'

  return (
    <>
      <style>{LOGIN_CSS}</style>
      <div className="login-screen">
        <FloatingBoxes />

        {/* Ambient glow */}
        <div className="login-glow" aria-hidden="true" />

        {/* Card */}
        <div className={`login-card${shake ? ' login-card-shake' : ''}`}>

          {/* ── Logo ─────────────────────────────────────────────────────── */}
          <div className="login-logo-wrap">
            <img src={logoJamaaw} alt="JamaaW" className="login-logo-img" />
          </div>

          {/* ── Titles ───────────────────────────────────────────────────── */}
          <h1 className="login-title">JamaaW Storage</h1>
          <p className="login-subtitle">Gestão inteligente de almoxarifado</p>

          {/* ── Decorative line ───────────────────────────────────────────── */}
          <div className="login-divider" />

          {/* ── Form ─────────────────────────────────────────────────────── */}
          <form ref={formRef} onSubmit={handleSubmit} className="login-form" noValidate>

            {/* E-mail field */}
            <div className="login-field">
              <label htmlFor="login-email" className="login-label">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: .45 }}>
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M2 7l10 7 10-7" />
                </svg>
                E-mail
              </label>
              <input
                id="login-email"
                type="email"
                className="login-input"
                placeholder="supervisor@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isDisabled}
              />
            </div>

            {/* Password field with toggle */}
            <div className="login-field">
              <label htmlFor="login-password" className="login-label">
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: .45 }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
                Senha
              </label>
              <div className="login-pw-wrap">
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  className="login-input login-input-pw"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isDisabled}
                />
                <button
                  type="button"
                  className="login-pw-toggle"
                  onClick={() => setShowPw((p) => !p)}
                  tabIndex={-1}
                  aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="login-error" role="alert">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#f87171" strokeWidth="2" />
                  <path d="M12 8v4" stroke="#f87171" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="16" r="1" fill="#f87171" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Submit button */}
            <button
              id="login-submit"
              type="submit"
              className={`login-btn${phase === 'success' ? ' login-btn-success' : ''}`}
              disabled={isDisabled}
            >
              {phase === 'idle' && (
                <>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="login-btn-arrow">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  <span>Entrar</span>
                </>
              )}
              {phase === 'loading' && (
                <>
                  <span className="login-btn-spinner" />
                  <span>Entrando…</span>
                </>
              )}
              {phase === 'success' && (
                <>
                  <span className="login-shelf-enter">
                    <ShelfIcon size={18} />
                  </span>
                  <span>Bem-vindo!</span>
                </>
              )}
            </button>
          </form>

          {/* ── Footer ────────────────────────────────────────────────────── */}
          <p className="login-footer">
            Acesso exclusivo para supervisores cadastrados
          </p>
        </div>
      </div>
    </>
  )
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const LOGIN_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600&display=swap');

/* ── Keyframes ─────────────────────────────────────────────────────────── */

@keyframes floatBox {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25%  { transform: translateY(-12px) rotate(2deg); }
  50%  { transform: translateY(-4px) rotate(-1deg); }
  75%  { transform: translateY(-16px) rotate(3deg); }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(24px) scale(.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@keyframes shelfPop {
  0%   { opacity: 0; transform: scale(.5) rotate(-12deg); }
  50%  { transform: scale(1.15) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); }
}
@keyframes shakeX {
  0%, 100% { transform: translateX(0); }
  20%  { transform: translateX(-6px); }
  40%  { transform: translateX(6px); }
  60%  { transform: translateX(-4px); }
  80%  { transform: translateX(4px); }
}
@keyframes pulseBtn {
  0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0); }
  50%      { box-shadow: 0 0 0 6px rgba(249,115,22,.15); }
}
@keyframes breatheGlow {
  0%, 100% { opacity: .6; }
  50%      { opacity: 1; }
}
@keyframes successGlow {
  from { box-shadow: 0 0 0 0 rgba(34,197,94,.3); }
  to   { box-shadow: 0 0 0 12px rgba(34,197,94,0); }
}

/* ── Screen ────────────────────────────────────────────────────────────── */

.login-screen {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: #060606;
  font-family: 'Outfit', sans-serif;
  overflow: hidden;
}

/* ── Floating boxes ────────────────────────────────────────────────────── */

.login-boxes-container {
  position: absolute; inset: 0;
  pointer-events: none; overflow: hidden;
}
.login-floating-box {
  position: absolute;
  animation: floatBox 8s ease-in-out infinite;
  will-change: transform;
}

/* ── Ambient glow ──────────────────────────────────────────────────────── */

.login-glow {
  position: absolute;
  width: 480px; height: 480px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(249,115,22,.08) 0%, transparent 65%);
  pointer-events: none;
  animation: breatheGlow 4s ease-in-out infinite;
}

/* ── Card ──────────────────────────────────────────────────────────────── */

.login-card {
  position: relative; z-index: 10;
  width: 100%; max-width: 380px;
  margin: 0 16px;
  padding: 32px 28px 24px;
  background: rgba(14,14,14,.96);
  border: 1px solid rgba(249,115,22,.12);
  border-radius: 18px;
  backdrop-filter: blur(24px);
  box-shadow:
    0 20px 60px rgba(0,0,0,.6),
    0 0 0 1px rgba(255,255,255,.03) inset,
    0 1px 0 rgba(255,255,255,.04) inset;
  animation: fadeInUp .55s cubic-bezier(.23,1,.32,1) both;
}
.login-card-shake {
  animation: shakeX .45s ease;
}

/* ── Logo ──────────────────────────────────────────────────────────────── */

.login-logo-wrap {
  display: flex; justify-content: center;
  margin-bottom: 14px;
}
.login-logo-img {
  height: 64px; width: auto;
  object-fit: contain;
  filter: drop-shadow(0 0 20px rgba(249,115,22,.25));
  transition: transform .3s;
}
.login-logo-img:hover {
  transform: scale(1.06) rotate(-2deg);
}

/* ── Titles ────────────────────────────────────────────────────────────── */

.login-title {
  margin: 0;
  text-align: center;
  font-size: 20px; font-weight: 700;
  letter-spacing: -.3px;
  color: #fff;
  font-family: 'Outfit', sans-serif;
}
.login-subtitle {
  margin: 5px 0 0;
  text-align: center;
  font-size: 12.5px;
  color: rgba(255,255,255,.35);
  font-family: 'Inter', sans-serif;
  letter-spacing: .15px;
}

/* ── Divider ───────────────────────────────────────────────────────────── */

.login-divider {
  height: 1px;
  margin: 18px 0;
  background: linear-gradient(90deg, transparent 0%, rgba(249,115,22,.22) 50%, transparent 100%);
}

/* ── Form ──────────────────────────────────────────────────────────────── */

.login-form {
  display: flex; flex-direction: column; gap: 14px;
}

.login-field {
  display: flex; flex-direction: column; gap: 5px;
}

.login-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 500;
  color: rgba(255,255,255,.55);
  font-family: 'Inter', sans-serif;
  letter-spacing: .15px;
}

.login-input {
  width: 100%;
  padding: 11px 13px;
  background: rgba(255,255,255,.035);
  border: 1.5px solid rgba(255,255,255,.08);
  border-radius: 10px;
  color: #fff;
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  outline: none;
  transition: border-color .2s, background .2s, box-shadow .2s;
  box-sizing: border-box;
}
.login-input:focus {
  border-color: rgba(249,115,22,.55);
  background: rgba(249,115,22,.04);
  box-shadow: 0 0 0 3px rgba(249,115,22,.08);
}
.login-input::placeholder {
  color: rgba(255,255,255,.2);
}
.login-input:disabled {
  opacity: .55; cursor: not-allowed;
}
.login-input:-webkit-autofill,
.login-input:-webkit-autofill:focus {
  -webkit-box-shadow: 0 0 0 1000px #121212 inset;
  -webkit-text-fill-color: #fff;
  transition: background-color 5000s ease-in-out 0s;
}

/* ── Password toggle ───────────────────────────────────────────────────── */

.login-pw-wrap {
  position: relative;
}
.login-input-pw {
  padding-right: 42px;
}
.login-pw-toggle {
  position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
  background: transparent; border: none;
  color: rgba(255,255,255,.3);
  cursor: pointer; padding: 8px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  transition: color .2s, background .2s;
}
.login-pw-toggle:hover {
  color: rgba(255,255,255,.6);
  background: rgba(255,255,255,.05);
}

/* ── Error ──────────────────────────────────────────────────────────────── */

.login-error {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px;
  background: rgba(239,68,68,.07);
  border: 1px solid rgba(239,68,68,.2);
  border-radius: 9px;
  font-size: 13px; color: #fca5a5;
  font-family: 'Inter', sans-serif;
}
.login-error svg { flex-shrink: 0; }

/* ── Button ────────────────────────────────────────────────────────────── */

.login-btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 10px;
  background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
  color: #fff;
  font-family: 'Outfit', sans-serif;
  font-size: 14.5px; font-weight: 600;
  letter-spacing: .3px;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  transition: opacity .2s, transform .12s, box-shadow .25s;
  animation: pulseBtn 3s ease-in-out infinite;
  position: relative; overflow: hidden;
}
.login-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 28px rgba(249,115,22,.35);
}
.login-btn:active:not(:disabled) {
  transform: translateY(0);
}
.login-btn:disabled {
  opacity: .7; cursor: not-allowed; animation: none;
}
.login-btn-success {
  background: linear-gradient(135deg, #16a34a 0%, #15803d 100%) !important;
  animation: successGlow .6s ease both !important;
}

.login-btn-arrow {
  transition: transform .2s;
}
.login-btn:hover:not(:disabled) .login-btn-arrow {
  transform: translateX(3px);
}

.login-btn-spinner {
  display: inline-block; width: 16px; height: 16px;
  border-radius: 50%;
  border: 2.5px solid rgba(255,255,255,.25);
  border-top-color: #fff;
  animation: spin .7s linear infinite;
}

.login-shelf-enter {
  display: flex; align-items: center;
  animation: shelfPop .4s cubic-bezier(.34,1.56,.64,1) both;
}

/* ── Footer ────────────────────────────────────────────────────────────── */

.login-footer {
  margin: 18px 0 0;
  text-align: center;
  font-size: 11px;
  color: rgba(255,255,255,.18);
  font-family: 'Inter', sans-serif;
}

/* ── Loading spinner (initial auth check) ──────────────────────────────── */

.login-initial-loader {
  width: 32px; height: 32px;
  border-radius: 50%;
  border: 3px solid rgba(249,115,22,.15);
  border-top-color: #f97316;
  animation: spin .8s linear infinite;
}
`
