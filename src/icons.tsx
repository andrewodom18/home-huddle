type IconProps = { size?: number; className?: string };

export function HomeIcon({ size = 20, className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d="m3.5 10 8.5-6.5 8.5 6.5v9.5H3.5V10Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M9 19.5v-6h6v6" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

export function ConversationIcon({ size = 20, className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <path d="M20 11.5a7.75 7.75 0 0 1-7.75 7.75c-1.4 0-2.7-.36-3.84-.99L4 20l1.16-4.14A7.75 7.75 0 1 1 20 11.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M8.5 11.5h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

export function InfoIcon({ size = 20, className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 10.5v5.5M12 7.8h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
    </svg>
  );
}

export function CalendarIcon({ size = 20, className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M7.5 3.5v4M16.5 3.5v4M3.5 10h17M8 14h3M8 17h3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

export function SparkIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M12 2.75c.48 4.9 2.85 7.27 7.75 7.75-4.9.48-7.27 2.85-7.75 7.75-.48-4.9-2.85-7.27-7.75-7.75C9.15 10.02 11.52 7.65 12 2.75Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function MicIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <rect
        height="11"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.7"
        width="7"
        x="8.5"
        y="2.5"
      />
      <path
        d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M8.5 21h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function ResetIcon({ size = 18, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path
        d="M4.75 8.25A8 8 0 1 1 4.4 15M4.75 8.25V3.75M4.75 8.25h4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
