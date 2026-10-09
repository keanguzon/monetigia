"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useThemeTransition } from "@/hooks/use-theme-transition"

export function ModeToggle() {
  const { theme, applyTheme, resolvedTheme } = useThemeTransition()

  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])

  const handleToggle = () => {
    if (theme === 'light') applyTheme('dark')
    else if (theme === 'dark') applyTheme('system')
    else applyTheme('light')
  }

  const effectiveTheme = mounted ? resolvedTheme : 'light'
  const isDark = effectiveTheme === 'dark'
  const label = !mounted ? 'Light' : (theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light')
  const activeIcon = !mounted ? (isDark ? "dark" : "light") : theme
  const iconColorClass = isDark ? "text-white" : "text-black"

  return (
    <button
      data-theme-toggle="true"
      onClick={handleToggle}
      aria-label="Toggle theme"
      className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:h-10 md:w-[88px] md:rounded-full md:p-[3px] md:hover:bg-transparent ${
        isDark
          ? "md:border md:border-primary/60 md:bg-[hsl(222_47%_11%/0.9)] md:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.15)]"
          : "md:border md:border-[#86efac] md:bg-[#dcfce7] md:shadow-[inset_0_0_0_1px_#bbf7d0]"
      }`}
      style={{
        transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
      }}
    >
      {/* Mobile animated icons: Monitor -> Moon -> Sun */}
      <span className="relative flex h-6 w-6 items-center justify-center md:hidden" aria-hidden="true">
        <Monitor
          className={`absolute h-6 w-6 transition-all duration-300 ${iconColorClass} ${
            activeIcon === "system"
              ? "scale-100 rotate-0 opacity-100"
              : "scale-50 -rotate-90 opacity-0 pointer-events-none"
          }`}
          strokeWidth={2.5}
        />
        <Moon
          className={`absolute h-6 w-6 transition-all duration-300 ${iconColorClass} ${
            activeIcon === "dark"
              ? "scale-100 rotate-0 opacity-100"
              : "scale-50 rotate-90 opacity-0 pointer-events-none"
          }`}
          strokeWidth={2.5}
        />
        <Sun
          className={`absolute h-6 w-6 transition-all duration-300 ${iconColorClass} ${
            activeIcon === "light"
              ? "scale-100 rotate-0 opacity-100"
              : "scale-50 rotate-90 opacity-0 pointer-events-none"
          }`}
          strokeWidth={2.5}
        />
      </span>
      {/* Sliding circle */}
      <div
        className="!hidden md:!flex"
        data-theme-toggle="true"
        aria-hidden="true"
        style={{
          position: 'absolute',
          width: 30,
          height: 30,
          borderRadius: '50%',
          top: 3,
          left: 3,
          backgroundColor: isDark ? 'hsl(var(--primary) / 0.22)' : '#bbf7d0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Performance-optimized slide using transform X, locked to 150ms
          transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1), background-color 150ms ease, box-shadow 150ms ease',
          transform: isDark ? 'translateX(0px)' : 'translateX(48px)',
          boxShadow: isDark
            ? '0 2px 8px hsl(var(--primary) / 0.18)'
            : '0 2px 8px rgba(34, 197, 94, 0.22)',
        }}
      >
        {isDark
          ? <Moon style={{ width: 14, height: 14, color: 'hsl(var(--primary) / 0.95)', transition: 'color 150ms ease' }} />
          : <Sun style={{ width: 14, height: 14, color: '#15803d', transition: 'color 150ms ease' }} />
        }
      </div>

      {/* Label text */}
      <span
        className="hidden md:inline"
        data-theme-toggle="true"
        style={{
          position: 'absolute',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.01em',
          userSelect: 'none',
          // Fade opacity rather than sliding the text left/right so it feels smoother
          transition: 'left 150ms cubic-bezier(0.4, 0, 0.2, 1), right 150ms cubic-bezier(0.4, 0, 0.2, 1), color 150ms ease',
          ...(isDark
            ? { right: 8, color: 'hsl(var(--primary) / 0.95)' }
            : { left: 8, color: '#15803d' }
          ),
        }}
      >
        {label}
      </span>
    </button>
  )
}
