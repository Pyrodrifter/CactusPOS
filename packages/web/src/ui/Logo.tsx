/**
 * The CactusPOS mark: a blue cactus under a Bonaire sun.
 * Keep the geometry in step with scripts/make-icons.py, which draws the same shapes
 * into the PNG home-screen icons, and with public/icons/logo.svg (the favicon).
 */
export function Logo({ size = 48, tile = true, title }: { size?: number; tile?: boolean; title?: string }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {tile && (
        <>
          <defs>
            <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#1b3a86" />
              <stop offset="1" stopColor="#0b1640" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="16" fill="url(#logo-bg)" />
        </>
      )}
      <circle cx="47" cy="17" r="6" fill="#ffc93c" />
      <g fill="none" stroke="#37c8dc" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 38H21V27" strokeWidth="7" />
        <path d="M32 44H43V32" strokeWidth="7" />
        <path d="M32 47V18" strokeWidth="11" />
      </g>
      <path d="M13 53H51" stroke="#4f74d9" strokeWidth="3" strokeLinecap="round" />
      <path d="M29.5 22V46" stroke="#9aeaf3" strokeWidth="2" strokeLinecap="round" opacity=".75" />
      <circle cx="32" cy="12.5" r="3.2" fill="#ff6fae" />
    </svg>
  );
}
