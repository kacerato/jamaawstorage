interface IconProps {
  size?: number
  className?: string
}

export function CameraIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M3 8C3 6.5 4 5.5 5.5 5.5H7L8.5 3.5H15.5L17 5.5H18.5C20 5.5 21 6.5 21 8V18C21 19.5 20 20.5 18.5 20.5H5.5C4 20.5 3 19.5 3 18V8Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="12" cy="13" r="1.5" fill="currentColor" />
    </svg>
  )
}
