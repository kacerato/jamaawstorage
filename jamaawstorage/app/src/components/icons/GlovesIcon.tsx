interface IconProps {
  size?: number
  className?: string
}

export function GlovesIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M6 20V11C6 9 7 8 8 8C9 8 9.5 9 9.5 10V6C9.5 4.5 10 3.5 11 3.5C12 3.5 12.5 4.5 12.5 6V8V5.5C12.5 4 13 3 14 3C15 3 15.5 4 15.5 5.5V8V6C15.5 4.5 16 3.5 17 3.5C18 3.5 18.5 4.5 18.5 6V13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 20H18.5V16C18.5 14.5 17.5 13.5 16 13H9C7 13 6 14 6 16V20Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 15.5H18.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
