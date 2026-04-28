interface IconProps {
  size?: number
  className?: string
}

export function PackageIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M3 7L12 2L21 7V17L12 22L3 17V7Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12 22V12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M3 7L12 12L21 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 4.5L16.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
