export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="brand-crystal-a" x1="8" y1="5" x2="41" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a89af2" />
          <stop offset=".42" stopColor="#7867d2" />
          <stop offset="1" stopColor="#b04491" />
        </linearGradient>
        <linearGradient id="brand-crystal-b" x1="24" y1="4" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity=".38" />
          <stop offset=".58" stopColor="#ffffff" stopOpacity=".04" />
          <stop offset="1" stopColor="#321c65" stopOpacity=".18" />
        </linearGradient>
        <radialGradient id="brand-crystal-glow" cx="0" cy="0" r="1" gradientTransform="translate(35 14) rotate(45) scale(11)">
          <stop stopColor="#dffbff" stopOpacity=".95" />
          <stop offset="1" stopColor="#dffbff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d="M24 2.8 44 24 24 45.2 4 24 24 2.8Z" fill="url(#brand-crystal-a)" />
      <path d="M24 2.8 44 24 24 45.2V24L4 24 24 2.8Z" fill="url(#brand-crystal-b)" />
      <path d="M24 4.8v38.2M5.8 24h36.4" fill="none" stroke="#ffffff" strokeOpacity=".26" strokeWidth=".9" />
      <path d="M24 2.8 44 24 24 45.2 4 24 24 2.8Z" fill="none" stroke="#ffffff" strokeOpacity=".34" strokeWidth="1" />
      <circle cx="35" cy="14" r="9" fill="url(#brand-crystal-glow)" />
      <circle cx="35" cy="14" r="2.2" fill="#e9fdff" />
    </svg>
  );
}
