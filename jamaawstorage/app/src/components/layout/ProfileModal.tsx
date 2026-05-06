import { useCallback, useEffect, useRef } from 'react'
import type { Tables } from '../../types/database'
import { useAuth } from '../../hooks/useAuth'
import { useNavigate } from 'react-router-dom'

interface ProfileModalProps {
  profile: Tables<'profiles'>
  onClose: () => void
}

function getInitials(fullName: string): string {
  return fullName
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function roleLabel(role: string): string {
  switch (role) {
    case 'supervisor':
      return 'Supervisor'
    case 'admin':
      return 'Administrador'
    default:
      return role
  }
}

export function ProfileModal({ profile, onClose }: ProfileModalProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const overlayRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Close on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose]
  )


  const handleEditProfile = useCallback(() => {
    onClose()
    navigate('/profile')
  }, [onClose, navigate])

  const initials = getInitials(profile.full_name ?? 'SU')

  return (
    <>
      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.93) translateY(-8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        .profile-modal-card {
          animation: modalIn 0.22s cubic-bezier(0.34,1.3,0.64,1) both;
        }
      `}</style>

      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        style={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-label="Perfil do supervisor"
      >
        {/* Card / Cracha */}
        <div className="profile-modal-card" style={styles.card}>
          {/* Close button */}
          <button
            onClick={onClose}
            style={styles.closeBtn}
            aria-label="Fechar perfil"
          >
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {/* Badge strip */}
          <div style={styles.badgeStrip} aria-hidden="true">
            <span style={styles.badgeText}>ALMOXARIFADO</span>
          </div>

          {/* Avatar */}
          <div style={styles.avatarWrapper}>
            <div style={styles.avatar}>
              {profile.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt={profile.full_name ?? 'Supervisor'}
                  style={styles.avatarImage}
                />
              ) : (
                initials
              )}
            </div>
            <div style={styles.avatarRing} aria-hidden="true" />
          </div>

          {/* Name & role */}
          <h2 style={styles.name}>{profile.full_name ?? 'Supervisor'}</h2>
          <span style={styles.rolePill}>{roleLabel(profile.role ?? 'supervisor')}</span>

          {/* Divider */}
          <div style={styles.divider} />

          {/* Details */}
          <div style={styles.details}>
            {user?.email && (
              <div style={styles.detailRow}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" style={styles.detailIcon}>
                  <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="2" />
                </svg>
                <span style={styles.detailText}>{user.email}</span>
              </div>
            )}
            {profile.employee_id && (
              <div style={styles.detailRow}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" style={styles.detailIcon}>
                  <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M9 9h6M9 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="7" cy="9" r="1" fill="currentColor" />
                  <circle cx="7" cy="12" r="1" fill="currentColor" />
                </svg>
                <span style={styles.detailText}>Matricula: {profile.employee_id}</span>
              </div>
            )}
            <div style={styles.detailRow}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" style={styles.detailIcon}>
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span style={styles.detailText}>
                Conta{' '}
                <span style={{ color: profile.is_active ? '#34d399' : '#f87171' }}>
                  {profile.is_active ? 'ativa' : 'inativa'}
                </span>
              </span>
            </div>
          </div>

      <button
        id="profile-edit-btn"
        onClick={handleEditProfile}
        style={{
          marginTop: 12,
          width: 'calc(100% - 32px)',
          padding: '10px 0',
          background: 'rgba(249,115,22,0.08)',
          border: '1px solid rgba(249,115,22,0.25)',
          borderRadius: 10,
          color: '#f97316',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "'Inter', sans-serif",
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Editar Perfil
      </button>


        </div>
      </div>
    </>
  )
}

// Styles

const styles = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 200,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    paddingTop: 68,
    paddingRight: 16,
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(4px)',
  },
  card: {
    width: 280,
    background: '#111111',
    border: '1px solid rgba(249,115,22,0.18)',
    borderRadius: 18,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    paddingBottom: 20,
    position: 'relative' as const,
  },
  closeBtn: {
    position: 'absolute' as const,
    top: 14,
    right: 14,
    background: 'rgba(15, 15, 15, 0.72)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    width: 34,
    height: 34,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    lineHeight: 0,
    transition: 'color 0.2s',
  },
  badgeStrip: {
    width: '100%',
    background: 'linear-gradient(135deg, #f97316, #c2410c)',
    padding: '10px 0 8px',
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 0,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '3px',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: "'Outfit', sans-serif",
  },
  avatarWrapper: {
    position: 'relative' as const,
    marginTop: 20,
    marginBottom: 12,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(249,115,22,0.25), rgba(249,115,22,0.12))',
    border: '2px solid rgba(249,115,22,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 700,
    color: '#f97316',
    fontFamily: "'Outfit', sans-serif",
    position: 'relative' as const,
    zIndex: 1,
    overflow: 'hidden' as const,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover' as const,
  },
  avatarRing: {
    position: 'absolute' as const,
    inset: -5,
    borderRadius: '50%',
    border: '1.5px dashed rgba(249,115,22,0.2)',
  },
  name: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#fff',
    fontFamily: "'Outfit', sans-serif",
    textAlign: 'center' as const,
    padding: '0 20px',
  },
  rolePill: {
    marginTop: 6,
    display: 'inline-block',
    padding: '3px 10px',
    background: 'rgba(249,115,22,0.12)',
    border: '1px solid rgba(249,115,22,0.25)',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    color: '#f97316',
    letterSpacing: '0.4px',
    fontFamily: "'Inter', sans-serif",
  },
  divider: {
    width: 'calc(100% - 32px)',
    height: 1,
    background: 'rgba(255,255,255,0.07)',
    margin: '16px 0',
  },
  details: {
    width: '100%',
    padding: '0 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 10,
  },
  detailRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  detailIcon: {
    color: 'rgba(255,255,255,0.35)',
    flexShrink: 0,
  },
  detailText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontFamily: "'Inter', sans-serif",
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  signOutBtn: {
    marginTop: 18,
    width: 'calc(100% - 32px)',
    padding: '10px 0',
    background: 'transparent',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: 10,
    color: '#f87171',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: "'Inter', sans-serif",
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    transition: 'background 0.2s, border-color 0.2s',
  },
} as const
