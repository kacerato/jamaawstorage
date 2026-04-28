interface IconProps {
  size?: number
  className?: string
}

export function UsersIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="2.5" />
      <path d="M2 20.5C2 17 5 14.5 9 14.5C13 14.5 16 17 16 20.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="17" cy="9" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M17 14C19.5 14 22 15.5 22 18.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
