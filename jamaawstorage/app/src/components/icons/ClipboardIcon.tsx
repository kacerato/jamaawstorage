interface IconProps {
  size?: number
  className?: string
}

export function ClipboardIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="4" y="4" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="2.5" />
      <rect x="8" y="2" width="8" height="4" rx="1.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11H8.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 11H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 15H8.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M11 15H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
