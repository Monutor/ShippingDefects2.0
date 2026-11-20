import { ref } from 'vue'
import { dbStore } from '@/lib/db'
import { setStoreNumber } from '@/utils/barcode'

// Профиль магазина: одна запись settings с ключом store_profile,
// значение { number: 'NNN', sealText: '...' }. null — не настроен (S000).
export const storeProfile = ref(null)

function applyProfile(profile) {
  storeProfile.value = profile
  setStoreNumber(profile ? profile.number : null)
}

export async function loadStoreProfile() {
  const res = await dbStore.settings.get('store_profile')
  const value = res.error ? null : res.data
  if (value && typeof value.number === 'string' && /^\d{3}$/.test(value.number)) {
    applyProfile({ number: value.number, sealText: String(value.sealText ?? '') })
  } else {
    applyProfile(null)
  }
}

export function isConfigured() {
  return storeProfile.value !== null
}

export function currentStoreNumber() {
  return storeProfile.value ? storeProfile.value.number : null
}

export function displayStoreNumber() {
  return currentStoreNumber() ?? '000'
}

export function currentSealText() {
  return storeProfile.value ? storeProfile.value.sealText : 'Магазин не настроен'
}

export async function setStoreProfile(number, sealText) {
  if (!/^\d{3}$/.test(String(number))) {
    throw new Error('Номер магазина — ровно 3 цифры')
  }
  const profile = { number: String(number), sealText: String(sealText ?? '').trim() }
  const res = await dbStore.settings.put('store_profile', profile)
  if (res.error) throw new Error(res.error)
  applyProfile(profile)
}
