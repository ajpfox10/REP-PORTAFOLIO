/**
 * Logo de Defensa Civil Argentina
 * Escudo celeste con franja blanca central y cruz naranja
 * Basado en los colores y símbolos oficiales de la institución
 */
export default function DefensaCivilLogo({ size = 80 }) {
  const h = size * 1.15;
  return (
    <svg width={size} height={h} viewBox="0 0 120 138" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="shield-clip">
          {/* Forma heráldica del escudo */}
          <path d="M60 4 L114 22 L114 76 Q114 118 60 134 Q6 118 6 76 L6 22 Z"/>
        </clipPath>
        <filter id="drop-shadow">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#00000044"/>
        </filter>
      </defs>

      {/* Sombra del escudo */}
      <path
        d="M60 4 L114 22 L114 76 Q114 118 60 134 Q6 118 6 76 L6 22 Z"
        fill="#00000022"
        transform="translate(2,3)"
      />

      {/* Fondo del escudo - celeste superior */}
      <rect x="0" y="0" width="120" height="46" fill="#74ACDF" clipPath="url(#shield-clip)"/>
      {/* Franja blanca central */}
      <rect x="0" y="46" width="120" height="46" fill="#FFFFFF" clipPath="url(#shield-clip)"/>
      {/* Fondo celeste inferior */}
      <rect x="0" y="92" width="120" height="46" fill="#74ACDF" clipPath="url(#shield-clip)"/>

      {/* Cruz de Defensa Civil - naranja fuego */}
      {/* Barra vertical */}
      <rect x="48" y="22" width="24" height="94" rx="2" fill="#F47920" clipPath="url(#shield-clip)"/>
      {/* Barra horizontal */}
      <rect x="20" y="55" width="80" height="24" rx="2" fill="#F47920" clipPath="url(#shield-clip)"/>

      {/* Centro de la cruz en blanco */}
      <rect x="48" y="55" width="24" height="24" fill="#FFFFFF" clipPath="url(#shield-clip)"/>

      {/* Borde exterior del escudo */}
      <path
        d="M60 4 L114 22 L114 76 Q114 118 60 134 Q6 118 6 76 L6 22 Z"
        fill="none"
        stroke="#003082"
        strokeWidth="5"
      />
      {/* Línea interior decorativa */}
      <path
        d="M60 10 L108 26 L108 76 Q108 113 60 128 Q12 113 12 76 L12 26 Z"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        opacity="0.5"
      />

      {/* Estrella de 8 puntas en el centro (símbolo defensa civil internacional) */}
      <g transform="translate(60, 67)" clipPath="url(#shield-clip)">
        <polygon points="0,-10 2.5,-2.5 10,0 2.5,2.5 0,10 -2.5,2.5 -10,0 -2.5,-2.5" fill="#F47920" opacity="0"/>
      </g>
    </svg>
  );
}
