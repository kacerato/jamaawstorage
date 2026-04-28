interface IconProps {
  size?: number
  className?: string
}

export function HelmetIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M4 16C4 10.4772 7.5817 6 12 6C16.4183 6 20 10.4772 20 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M2 16H22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <rect x="3" y="16" width="18" height="3" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M12 6V3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M9 3.5L12 2L15 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
