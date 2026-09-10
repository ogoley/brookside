import { ref as storageRef, deleteObject } from 'firebase/storage'
import { storage } from './firebase'

/** Best-effort delete of a Firebase Storage object by its download URL. */
export function deleteStorageLogo(url: string) {
  try {
    const match = url.match(/\/o\/(.+?)(\?|$)/)
    if (!match) return
    const path = decodeURIComponent(match[1])
    deleteObject(storageRef(storage, path)).catch(() => {/* ignore if already gone */})
  } catch {/* ignore */}
}
