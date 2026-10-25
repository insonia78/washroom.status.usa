import { ANSI_COLORS, ANSI_RESET } from "../config/constants.ts"

// Writes a timestamped, color-coded informational log entry.
export function logWithColor(label: string, color: string, message: string, details?: unknown) {
  const timestamp = new Date().toISOString()
  const prefix = `${color}[${timestamp}] [${label}]${ANSI_RESET}`

  if (typeof details === "undefined") {
    console.log(`${prefix} ${message}`)
    return
  }

  console.log(`${prefix} ${message}`, details)
}

// Writes a timestamped error log entry with optional details.
export function logError(label: string, message: string, details?: unknown) {
  const timestamp = new Date().toISOString()
  const prefix = `${ANSI_COLORS.red}[${timestamp}] [${label}]${ANSI_RESET}`

  if (typeof details === "undefined") {
    console.error(`${prefix} ${message}`)
    return
  }

  console.error(`${prefix} ${message}`, details)
}
