interface IconProps {
  size?: number
  className?: string
}

export function NewConditionIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M16 2H22V8L13 17L7 11L16 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="18.5" cy="5.5" r="1.5" fill="currentColor" />
      <path d="M13 6L16 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      
      <path d="M4 20L10 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 22L12 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M11 9L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 10L18 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
