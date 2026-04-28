interface IconProps {
  size?: number
  className?: string
}

export function KitIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M4 9L12 4L20 9V18C20 19.5 19 20.5 17.5 20.5H6.5C5 20.5 4 19.5 4 18V9Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M4 9H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M10 20V15H14V20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="12.5" r="1" fill="currentColor" />
      <circle cx="15" cy="12.5" r="1" fill="currentColor" />
      <path d="M20 9L22 7L20 5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 5.5C19 4 17 4.5 16.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
