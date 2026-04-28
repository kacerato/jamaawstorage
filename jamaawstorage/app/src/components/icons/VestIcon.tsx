interface IconProps {
  size?: number
  className?: string
}

export function VestIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M8 3H16L18 7V21H6V7L8 3Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 7H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 12H18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 7V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 7V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 3V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 3V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
