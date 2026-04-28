interface IconProps {
  size?: number
  className?: string
}

export function AlertIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M12 3L22 20H2L12 3Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M12 10V14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1.5" fill="currentColor" />
    </svg>
  )
}
