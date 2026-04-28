interface IconProps {
  size?: number
  className?: string
}

export function PliersIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M6 4L12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M18 4L12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="12" cy="13" rx="2.5" ry="3" stroke="currentColor" strokeWidth="2" />
      <path d="M12 16L11 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M12 16L13 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M5.5 5.5C5.5 5.5 4 4 3 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M18.5 5.5C18.5 5.5 20 4 21 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.5 12L6 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M13.5 12L18 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
