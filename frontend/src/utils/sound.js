const base = import.meta.env.BASE_URL || '/'

const sounds = {
  success: null,
  error: null,
  undo: null
}

let initialized = false

export function initSounds() {
  if (initialized) return
  initialized = true

  sounds.success = new Audio(`${base}sounds/success-sound.wav`)
  sounds.error = new Audio(`${base}sounds/error-sound.wav`)
  sounds.undo = new Audio(`${base}sounds/undo-sounds.wav`)

  // Ограничиваем длительность воспроизведения
  Object.values(sounds).forEach((audio) => {
    if (audio) {
      audio.preload = 'auto'
      audio.volume = 0.5
    }
  })
}

export function playSound(type, duration = 300) {
  const audio = sounds[type]
  if (!audio) return

  audio.currentTime = 0
  audio.play().catch(() => {})

  // Останавливаем через заданное время
  setTimeout(() => {
    audio.pause()
    audio.currentTime = 0
  }, duration)
}
