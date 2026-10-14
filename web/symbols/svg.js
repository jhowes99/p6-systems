/**
 * P6 industrial SVG builders — original geometry (not Ignition proprietary).
 * Modes: pid (schematic line art) · scada (status / levels / alarms).
 */
(function (global) {
  const P6 = (global.P6Symbols = global.P6Symbols || {});

  const C = {
    line: "#8ec8e8",
    accent: "#28C5FF",
    run: "#22C55E",
    warn: "#F59E0B",
    alarm: "#EF4444",
    mute: "#5a7188",
    fill: "rgba(40,197,255,0.12)",
    fluid: "rgba(34,197,94,0.55)"
  };

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function pidPump(s) {
    const on = !!s.running;
    const stroke = on ? C.run : C.accent;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-pump" aria-hidden="true">
      <circle cx="32" cy="24" r="14" fill="none" stroke="${stroke}" stroke-width="2"/>
      <path d="M32 10 L38 24 L32 38 L26 24 Z" fill="none" stroke="${stroke}" stroke-width="1.5"/>
      <path d="M4 24 H18" stroke="${C.line}" stroke-width="2"/>
      <path d="M46 24 H60" stroke="${C.line}" stroke-width="2"/>
      <circle cx="32" cy="24" r="3" fill="${on ? C.run : C.mute}" class="${on ? "rotor" : ""}"/>
    </svg>`;
  }

  function scadaPump(s) {
    const on = !!s.running;
    const fault = !!s.fault;
    const stroke = fault ? C.alarm : on ? C.run : C.accent;
    const fill = fault ? "rgba(239,68,68,0.2)" : on ? "rgba(34,197,94,0.18)" : C.fill;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-pump scada" aria-hidden="true">
      <circle cx="32" cy="24" r="14" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
      <path d="M32 12 L36 24 L32 36 L28 24 Z" fill="${stroke}" opacity="0.85" class="${on && !fault ? "rotor" : ""}"/>
      <path d="M4 24 H18" stroke="${on ? C.run : C.line}" stroke-width="2.5"/>
      <path d="M46 24 H60" stroke="${on ? C.run : C.line}" stroke-width="2.5"/>
      ${fault ? `<text x="32" y="46" text-anchor="middle" fill="${C.alarm}" font-size="8" font-family="sans-serif">FLT</text>` : ""}
    </svg>`;
  }

  function pidMotor(s) {
    const on = !!s.running;
    const stroke = on ? C.run : C.accent;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-motor" aria-hidden="true">
      <rect x="14" y="12" width="36" height="24" rx="4" fill="none" stroke="${stroke}" stroke-width="2"/>
      <text x="32" y="28" text-anchor="middle" fill="${stroke}" font-size="12" font-family="sans-serif" font-weight="700">M</text>
      <path d="M32 36 V44" stroke="${C.line}" stroke-width="2"/>
      <path d="M4 20 H14 M4 28 H14" stroke="${C.warn}" stroke-width="1.5"/>
    </svg>`;
  }

  function scadaMotor(s) {
    const on = !!s.running;
    const fault = !!s.fault;
    const stroke = fault ? C.alarm : on ? C.run : C.accent;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-motor scada" aria-hidden="true">
      <rect x="14" y="12" width="36" height="24" rx="4" fill="${fault ? "rgba(239,68,68,0.2)" : on ? "rgba(34,197,94,0.2)" : C.fill}" stroke="${stroke}" stroke-width="2.5"/>
      <text x="32" y="28" text-anchor="middle" fill="${stroke}" font-size="12" font-family="sans-serif" font-weight="700">M</text>
      <circle cx="32" cy="24" r="5" fill="none" stroke="${stroke}" stroke-width="1.5" class="${on && !fault ? "rotor" : ""}"/>
      <path d="M32 36 V44" stroke="${C.line}" stroke-width="2"/>
      <path d="M4 20 H14 M4 28 H14" stroke="${C.warn}" stroke-width="1.5"/>
    </svg>`;
  }

  function pidValve(s) {
    const open = s.valveState === "open";
    const mid = s.valveState === "opening";
    const fill = open ? C.run : mid ? C.warn : C.mute;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-valve" aria-hidden="true">
      <path d="M8 24 L26 12 L26 36 Z" fill="none" stroke="${fill}" stroke-width="2"/>
      <path d="M56 24 L38 12 L38 36 Z" fill="none" stroke="${fill}" stroke-width="2"/>
      <rect x="30" y="${open ? 8 : mid ? 14 : 18}" width="4" height="${open ? 32 : mid ? 20 : 12}" fill="${C.accent}" class="valveStem"/>
      <path d="M2 24 H8 M56 24 H62" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function scadaValve(s) {
    const open = s.valveState === "open";
    const mid = s.valveState === "opening";
    const fill = open ? C.run : mid ? C.warn : "#20B8A6";
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-valve scada" aria-hidden="true">
      <path d="M8 24 L26 12 L26 36 Z" fill="${fill}" opacity="0.9"/>
      <path d="M56 24 L38 12 L38 36 Z" fill="${fill}" opacity="0.9"/>
      <rect x="30" y="${open ? 8 : mid ? 14 : 18}" width="4" height="${open ? 32 : mid ? 20 : 12}" fill="${C.accent}" class="valveStem"/>
      <path d="M2 24 H8 M56 24 H62" stroke="${open ? C.run : C.line}" stroke-width="2.5"/>
    </svg>`;
  }

  function pidTank(_s) {
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-tank" aria-hidden="true">
      <path d="M16 8 H48 V40 Q32 46 16 40 Z" fill="none" stroke="${C.accent}" stroke-width="2"/>
      <path d="M16 8 Q32 2 48 8" fill="none" stroke="${C.accent}" stroke-width="2"/>
      <path d="M48 28 H58" stroke="${C.line}" stroke-width="2"/>
      <path d="M6 28 H16" stroke="${C.line}" stroke-width="2"/>
      <path d="M32 2 V8" stroke="${C.mute}" stroke-width="1.5"/>
    </svg>`;
  }

  function scadaTank(s) {
    const lvl = clamp(Number(s.levelPct) || 0, 0, 100);
    const y = 38 - (lvl / 100) * 26;
    const h = Math.max(1, (lvl / 100) * 26);
    const alarm = !!s.alarm || lvl >= 90;
    const stroke = alarm ? C.alarm : C.accent;
    // No clipPath ids — duplicate SVG ids break when many tanks share the DOM
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-tank scada" aria-hidden="true">
      <path d="M16 8 H48 V40 Q32 46 16 40 Z" fill="${C.fill}" stroke="${stroke}" stroke-width="2"/>
      <rect x="18" y="${y}" width="28" height="${h}" rx="1" fill="${C.fluid}" class="flowPulse"/>
      <path d="M16 8 Q32 2 48 8" fill="none" stroke="${stroke}" stroke-width="2"/>
      <path d="M48 28 H58 M6 28 H16" stroke="${C.line}" stroke-width="2"/>
      <text x="32" y="30" text-anchor="middle" fill="#cfe8f5" font-size="9" font-family="sans-serif">${Math.round(lvl)}%</text>
    </svg>`;
  }

  function pidVessel(_s) {
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-vessel" aria-hidden="true">
      <ellipse cx="32" cy="24" rx="18" ry="16" fill="none" stroke="${C.accent}" stroke-width="2"/>
      <path d="M14 24 H8 M50 24 H56 M32 8 V4" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function scadaVessel(s) {
    const on = !!s.running;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-vessel scada" aria-hidden="true">
      <ellipse cx="32" cy="24" rx="18" ry="16" fill="${C.fill}" stroke="${on ? C.run : C.accent}" stroke-width="2.5"/>
      <path d="M14 24 H8 M50 24 H56 M32 8 V4" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function pidMixer(s) {
    const on = !!s.running;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-mixer" aria-hidden="true">
      <rect x="18" y="8" width="28" height="32" rx="3" fill="none" stroke="${C.accent}" stroke-width="2"/>
      <path d="M32 12 V36" stroke="${on ? C.run : C.mute}" stroke-width="2" class="${on ? "rotor" : ""}"/>
      <path d="M22 20 H42 M24 28 H40" stroke="${on ? C.run : C.mute}" stroke-width="1.5"/>
      <path d="M8 30 H18 M46 30 H56" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function scadaMixer(s) {
    return pidMixer(s).replace('class="p6sym p6sym-mixer"', 'class="p6sym p6sym-mixer scada"');
  }

  function pidCompressor(s) {
    const on = !!s.running;
    const stroke = on ? C.run : C.accent;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-compressor" aria-hidden="true">
      <path d="M12 32 L32 8 L52 32 Z" fill="none" stroke="${stroke}" stroke-width="2"/>
      <circle cx="32" cy="28" r="6" fill="none" stroke="${stroke}" stroke-width="1.5" class="${on ? "rotor" : ""}"/>
      <path d="M4 32 H12 M52 32 H60" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function scadaCompressor(s) {
    return pidCompressor(s).replace('p6sym-compressor"', 'p6sym-compressor scada"');
  }

  function pidBlower(s) {
    const on = !!s.running;
    const stroke = on ? C.run : C.accent;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-blower" aria-hidden="true">
      <circle cx="32" cy="24" r="12" fill="none" stroke="${stroke}" stroke-width="2"/>
      <path d="M32 12 Q40 24 32 36 Q24 24 32 12" fill="none" stroke="${stroke}" stroke-width="1.5" class="${on ? "rotor" : ""}"/>
      <path d="M4 24 H20 M44 24 H60" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function scadaBlower(s) {
    return pidBlower(s).replace('p6sym-blower"', 'p6sym-blower scada"');
  }

  function pidHx(_s) {
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-hx" aria-hidden="true">
      <rect x="12" y="10" width="40" height="28" rx="2" fill="none" stroke="${C.accent}" stroke-width="2"/>
      <path d="M18 16 H46 M18 24 H46 M18 32 H46" stroke="${C.line}" stroke-width="1.5"/>
      <path d="M4 18 H12 M4 30 H12 M52 18 H60 M52 30 H60" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function scadaHx(s) {
    const on = !!s.running;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-hx scada" aria-hidden="true">
      <rect x="12" y="10" width="40" height="28" rx="2" fill="${C.fill}" stroke="${on ? C.run : C.accent}" stroke-width="2"/>
      <path d="M18 16 H46 M18 24 H46 M18 32 H46" stroke="${on ? C.run : C.line}" stroke-width="1.5"/>
      <path d="M4 18 H12 M4 30 H12 M52 18 H60 M52 30 H60" stroke="${C.line}" stroke-width="2"/>
    </svg>`;
  }

  function pidTransmitter(letter) {
    return function (_s) {
      return `<svg viewBox="0 0 64 48" class="p6sym p6sym-tx" aria-hidden="true">
        <circle cx="32" cy="22" r="12" fill="none" stroke="${C.warn}" stroke-width="2"/>
        <text x="32" y="26" text-anchor="middle" fill="${C.warn}" font-size="11" font-family="sans-serif" font-weight="700">${letter}</text>
        <path d="M32 34 V44" stroke="${C.line}" stroke-width="1.5" stroke-dasharray="3 2"/>
      </svg>`;
    };
  }

  function scadaTransmitter(letter) {
    return function (s) {
      const alarm = !!s.alarm;
      const stroke = alarm ? C.alarm : C.warn;
      const val = s.displayValue != null ? String(s.displayValue) : "";
      return `<svg viewBox="0 0 64 48" class="p6sym p6sym-tx scada" aria-hidden="true">
        <circle cx="32" cy="20" r="12" fill="${alarm ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.15)"}" stroke="${stroke}" stroke-width="2.5"/>
        <text x="32" y="24" text-anchor="middle" fill="${stroke}" font-size="11" font-family="sans-serif" font-weight="700">${letter}</text>
        ${val ? `<text x="32" y="44" text-anchor="middle" fill="#cfe8f5" font-size="8" font-family="sans-serif">${val}</text>` : `<path d="M32 32 V42" stroke="${C.line}" stroke-width="1.5" stroke-dasharray="3 2"/>`}
      </svg>`;
    };
  }

  function pidSwitch(_s) {
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-switch" aria-hidden="true">
      <circle cx="32" cy="22" r="12" fill="none" stroke="${C.warn}" stroke-width="2"/>
      <path d="M26 22 H38 M32 16 V28" stroke="${C.warn}" stroke-width="2"/>
      <path d="M32 34 V44" stroke="${C.line}" stroke-width="1.5"/>
    </svg>`;
  }

  function scadaSwitch(s) {
    const active = !!s.active;
    const stroke = active ? C.alarm : C.warn;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-switch scada" aria-hidden="true">
      <circle cx="32" cy="22" r="12" fill="${active ? "rgba(239,68,68,0.25)" : "rgba(245,158,11,0.12)"}" stroke="${stroke}" stroke-width="2.5"/>
      <path d="M26 22 H38 M32 16 V28" stroke="${stroke}" stroke-width="2"/>
      <text x="32" y="44" text-anchor="middle" fill="${stroke}" font-size="8" font-family="sans-serif">${active ? "HI" : "OK"}</text>
    </svg>`;
  }

  function pidEstop(_s) {
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-estop" aria-hidden="true">
      <circle cx="32" cy="24" r="14" fill="none" stroke="${C.alarm}" stroke-width="2.5"/>
      <circle cx="32" cy="24" r="9" fill="${C.alarm}"/>
      <text x="32" y="28" text-anchor="middle" fill="#fff" font-size="9" font-family="sans-serif" font-weight="700">E</text>
    </svg>`;
  }

  function scadaEstop(s) {
    const healthy = s.healthy !== false && !s.active;
    const stroke = healthy ? C.run : C.alarm;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-estop scada" aria-hidden="true">
      <circle cx="32" cy="24" r="14" fill="${healthy ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.35)"}" stroke="${stroke}" stroke-width="2.5"/>
      <circle cx="32" cy="24" r="9" fill="${healthy ? C.mute : C.alarm}"/>
      <text x="32" y="28" text-anchor="middle" fill="#fff" font-size="9" font-family="sans-serif" font-weight="700">E</text>
    </svg>`;
  }

  function pidGeneric(_s) {
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-generic" aria-hidden="true">
      <rect x="12" y="10" width="40" height="28" rx="3" fill="none" stroke="${C.mute}" stroke-width="2"/>
    </svg>`;
  }

  function scadaGeneric(s) {
    const on = !!s.running;
    return `<svg viewBox="0 0 64 48" class="p6sym p6sym-generic scada" aria-hidden="true">
      <rect x="12" y="10" width="40" height="28" rx="3" fill="${C.fill}" stroke="${on ? C.run : C.mute}" stroke-width="2"/>
    </svg>`;
  }

  /** Control / butterfly / check valve variants share diamond body with labels */
  function pidValveVariant(kind) {
    return function (s) {
      const base = pidValve(s);
      const label = kind === "check" ? "C" : kind === "butterfly" ? "BF" : kind === "control" ? "CV" : "";
      if (!label) return base;
      return base.replace("</svg>", `<text x="32" y="46" text-anchor="middle" fill="${C.mute}" font-size="7" font-family="sans-serif">${label}</text></svg>`);
    };
  }

  function scadaValveVariant(kind) {
    return function (s) {
      const base = scadaValve(s);
      const label = kind === "check" ? "C" : kind === "butterfly" ? "BF" : kind === "control" ? "CV" : "";
      if (!label) return base;
      return base.replace("</svg>", `<text x="32" y="46" text-anchor="middle" fill="${C.mute}" font-size="7" font-family="sans-serif">${label}</text></svg>`);
    };
  }

  P6.svg = {
    pump: { pid: pidPump, scada: scadaPump },
    motor: { pid: pidMotor, scada: scadaMotor },
    valve: { pid: pidValve, scada: scadaValve },
    control_valve: { pid: pidValveVariant("control"), scada: scadaValveVariant("control") },
    check_valve: { pid: pidValveVariant("check"), scada: scadaValveVariant("check") },
    butterfly_valve: { pid: pidValveVariant("butterfly"), scada: scadaValveVariant("butterfly") },
    tank: { pid: pidTank, scada: scadaTank },
    vessel: { pid: pidVessel, scada: scadaVessel },
    mixer: { pid: pidMixer, scada: scadaMixer },
    compressor: { pid: pidCompressor, scada: scadaCompressor },
    blower: { pid: pidBlower, scada: scadaBlower },
    heat_exchanger: { pid: pidHx, scada: scadaHx },
    level_transmitter: { pid: pidTransmitter("L"), scada: scadaTransmitter("L") },
    flow_transmitter: { pid: pidTransmitter("F"), scada: scadaTransmitter("F") },
    pressure_transmitter: { pid: pidTransmitter("P"), scada: scadaTransmitter("P") },
    temperature_transmitter: { pid: pidTransmitter("T"), scada: scadaTransmitter("T") },
    level_switch: { pid: pidSwitch, scada: scadaSwitch },
    pressure_switch: { pid: pidSwitch, scada: scadaSwitch },
    emergency_stop_input: { pid: pidEstop, scada: scadaEstop },
    generic: { pid: pidGeneric, scada: scadaGeneric }
  };
})(typeof window !== "undefined" ? window : globalThis);
