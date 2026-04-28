interface IconProps {
  size?: number
  className?: string
}

export function BuildingIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M4 21V4C4 2.5 5 2 6 2H14C15 2 16 2.5 16 4V21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 10H20C21 10 22 11 22 12V21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="7" y="5" width="2.5" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="10" width="2.5" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="7" y="15" width="2.5" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="5" width="2.5" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="10" width="2.5" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 15H13.5V21H11V15Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 13H19.5V15H18V13Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M18 17H19.5V19H18V17Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 21H22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
