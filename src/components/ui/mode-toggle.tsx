"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

export function ModeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const timeoutRef = React.useRef<number | null>(null)

  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => {
    setMounted(true)
  }, [])

  const applyTheme = (t: string) => {
    const root = document.documentElement
    root.classList.add("theme-transitioning")
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTheme(t)
        // Keep in sync with the 150ms transition
        timeoutRef.current = window.setTimeout(() => {
          root.classList.remove("theme-transitioning")
          timeoutRef.current = null
        }, 160)
      })
    })
  }

  const handleToggle = () => {
    if (theme === 'light') applyTheme('dark')
    else if (theme === 'dark') applyTheme('system')
    else applyTheme('light')
  }

  const effectiveTheme = mounted ? resolvedTheme : 'light'
  const isDark = effectiveTheme === 'dark'
  const label = !mounted ? 'Light' : (theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light')

  return (
    <button
      data-theme-toggle="true"
      onClick={handleToggle}
      aria-label="Toggle theme"
      style={{
        // pill track
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: 88,
        height: 40,
        borderRadius: 999,
        border: isDark ? '1px solid hsl(var(--primary) / 0.6)' : '1px solid #86efac',
        backgroundColor: isDark ? 'hsl(222 47% 11% / 0.9)' : '#dcfce7',
        padding: '3px',
        cursor: 'pointer',
        outline: 'none',
        boxShadow: isDark
          ? '0 0 0 1px hsl(var(--primary) / 0.15) inset'
          : '0 0 0 1px #bbf7d0 inset',
        // 150ms exact sync with theme-transitioning website fade
        transition: 'background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
        flexShrink: 0,
      }}
    >
      {/* Sliding circle */}
      <div
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
