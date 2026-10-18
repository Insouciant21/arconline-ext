export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="brand-prism-a" x1="9" y1="7" x2="39" y2="41" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8d78dc" />
          <stop offset=".48" stopColor="#6857bd" />
          <stop offset="1" stopColor="#a3428e" />
        </linearGradient>
        <linearGradient id="brand-prism-b" x1="24" y1="5" x2="24" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity=".34" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M24 3.5 41.7 13.7v20.6L24 44.5 6.3 34.3V13.7L24 3.5Z" fill="url(#brand-prism-a)" />
      <path d="m24 3.5 17.7 10.2L24 24 6.3 13.7 24 3.5Z" fill="url(#brand-prism-b)" />
      <path d="M24 24 6.3 13.7v20.6L24 44.5V24Z" fill="#2f2865" fillOpacity=".2" />
      <path d="M24 24 41.7 13.7v20.6L24 44.5V24Z" fill="#ffffff" fillOpacity=".08" />
      <path d="M24 24v20.5M6.3 13.7 24 24l17.7-10.3" fill="none" stroke="#ffffff" strokeOpacity=".42" strokeWidth="1.1" />
      <circle cx="35.8" cy="16.6" r="2.3" fill="#dff8ff" />
      <circle cx="35.8" cy="16.6" r="4.8" fill="none" stroke="#dff8ff" strokeOpacity=".34" strokeWidth="1" />
    </svg>
  );
}
