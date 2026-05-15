interface IconProps {
  size?: number
  className?: string
}

export function UsedConditionIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M4 20L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 22L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M11 9L15 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 10L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      
      <path d="M22 13C22 16.5 19.5 19 16 19C12.5 19 10 16.5 10 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 16.5H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 16.5V19.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
