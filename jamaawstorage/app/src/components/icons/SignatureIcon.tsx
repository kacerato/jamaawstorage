interface IconProps {
  size?: number
  className?: string
}

export function SignatureIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M4 20C6 18 8 14 10 12C12 10 13 11 14 10C15 9 14.5 7.5 16 7C17.5 6.5 18 8 17 9.5C16 11 14 13 14 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M17 7L19 5C19.5 4.5 20.5 4.5 21 5C21.5 5.5 21.5 6.5 21 7L19 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 21H21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M4 17L6 18.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
