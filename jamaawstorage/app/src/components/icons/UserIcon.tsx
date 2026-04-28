interface IconProps {
  size?: number
  className?: string
}

export function UserIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2.5" />
      <path d="M4 21C4 16.5817 7.5817 13.5 12 13.5C16.4183 13.5 20 16.5817 20 21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}
