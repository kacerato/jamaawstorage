interface IconProps {
  size?: number
  className?: string
}

export function ChartIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="3" y="14" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="10" y="8" width="4" height="13" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="17" y="3" width="4" height="18" rx="1" stroke="currentColor" strokeWidth="2" />
      <path d="M2 21H22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
