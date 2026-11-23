export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="brand-facet-tl" x1="8" y1="6" x2="23" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#bdf3ff" />
          <stop offset="1" stopColor="#8c7fe9" />
        </linearGradient>
        <linearGradient id="brand-facet-tr" x1="25" y1="4" x2="41" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6cc9e6" />
          <stop offset="1" stopColor="#6655c0" />
        </linearGradient>
        <linearGradient id="brand-facet-bl" x1="7" y1="25" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5746ad" />
          <stop offset="1" stopColor="#362776" />
        </linearGradient>
        <linearGradient id="brand-facet-br" x1="25" y1="26" x2="41" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c248a0" />
          <stop offset="1" stopColor="#7b236e" />
        </linearGradient>
        <linearGradient id="brand-table-tl" x1="12" y1="11" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#988cf0" />
          <stop offset="1" stopColor="#6d5dcb" />
        </linearGradient>
        <linearGradient id="brand-table-tr" x1="24" y1="11" x2="36" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#836cd6" />
          <stop offset="1" stopColor="#8a4399" />
        </linearGradient>
        <linearGradient id="brand-table-bl" x1="12" y1="24" x2="24" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6350b8" />
          <stop offset="1" stopColor="#473493" />
        </linearGradient>
        <linearGradient id="brand-table-br" x1="24" y1="24" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#a84293" />
          <stop offset="1" stopColor="#762872" />
        </linearGradient>
        <linearGradient id="brand-core-gem" x1="24" y1="19.2" x2="24" y2="28.8" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#97eefc" />
        </linearGradient>
        <radialGradient
          id="brand-prism-glint"
          cx="24"
          cy="9.5"
          r="6"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffffff" stopOpacity=".58" />
          <stop offset="1" stopColor="#a6ecfb" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Solid backing prevents sub-pixel hairline seams along bevel diagonals */}
      <path d="M24 2 43.5 24 24 46 4.5 24Z" fill="#5e4eb5" />

      {/* Four beveled outer crystal facets */}
      <path d="M24 2 4.5 24 11.2 24 24 9.5Z" fill="url(#brand-facet-tl)" />
      <path d="M24 2 43.5 24 36.8 24 24 9.5Z" fill="url(#brand-facet-tr)" />
      <path d="M4.5 24 24 46 24 38.5 11.2 24Z" fill="url(#brand-facet-bl)" />
      <path d="M43.5 24 24 46 24 38.5 36.8 24Z" fill="url(#brand-facet-br)" />

      {/* Four refractive inner quadrant facets */}
      <path d="M24 9.5 11.2 24 24 24Z" fill="url(#brand-table-tl)" />
      <path d="M24 9.5 36.8 24 24 24Z" fill="url(#brand-table-tr)" />
      <path d="M11.2 24 24 38.5 24 24Z" fill="url(#brand-table-bl)" />
      <path d="M36.8 24 24 38.5 24 24Z" fill="url(#brand-table-br)" />

      {/* Inner facet edges, bevel struts, and outer rim highlight */}
      <path
        d="M24 2v7.5M43.5 24h-6.7M24 46v-7.5M4.5 24h6.7M24 9.5 36.8 24 24 38.5 11.2 24Z"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".34"
        strokeWidth=".9"
        strokeLinejoin="miter"
      />
      <path
        d="M24 9.5v5.7M36.8 24h-5.2M24 38.5v-5.7M11.2 24h5.2"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".22"
        strokeWidth=".85"
        strokeLinejoin="miter"
      />
      <path
        d="M24 2 43.5 24 24 46 4.5 24Z"
        fill="none"
        stroke="#ffffff"
        strokeOpacity=".46"
        strokeWidth="1"
        strokeLinejoin="miter"
      />

      {/* Centered double-layer suspended memory diamond core */}
      <path
        d="M24 15.2 31.6 24 24 32.8 16.4 24Z"
        fill="#ffffff"
        fillOpacity=".12"
        stroke="#ffffff"
        strokeOpacity=".78"
        strokeWidth="1.15"
        strokeLinejoin="miter"
      />
      <path d="M24 19.2 28.1 24 24 28.8 19.9 24Z" fill="url(#brand-core-gem)" />

      {/* Crown prism specular glint */}
      <circle cx="24" cy="9.5" r="6" fill="url(#brand-prism-glint)" />
      <circle cx="24" cy="9.5" r="1.25" fill="#ffffff" fillOpacity=".88" />
    </svg>
  );
}
