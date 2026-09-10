import { useRef, useState } from 'react'
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { storage } from '../firebase'
import { deleteStorageLogo } from '../storageUtils'

export function LogoUpload({ currentUrl, teamName, onUploaded, folder = 'logos' }: {
  currentUrl: string
  teamName: string
  onUploaded: (url: string) => void
  /** Storage folder — "logos" for teams, "sponsors" for sponsor art */
  folder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file.')
      return
    }
    setError(null)
    const ext = file.name.split('.').pop()
    const path = `${folder}/${teamName.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.${ext}`
    const sRef = storageRef(storage, path)
    const task = uploadBytesResumable(sRef, file)

    task.on(
      'state_changed',
      snap => setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      () => { setError('Upload failed. Check Firebase Storage rules.'); setProgress(null) },
      async () => {
        if (currentUrl) deleteStorageLogo(currentUrl)
        const url = await getDownloadURL(task.snapshot.ref)
        onUploaded(url)
        setProgress(null)
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Current logo or placeholder */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: '#1c2333', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {currentUrl ? (
            <img src={currentUrl} alt="" className="w-full h-full object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
          ) : (
            <span style={{ fontSize: 20 }}>🖼</span>
          )}
        </div>

        {/* Upload button */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={progress !== null}
          className="h-11 px-4 rounded-lg text-sm font-semibold transition-colors shrink-0"
          style={{
            background: 'rgba(255,255,255,0.07)',
            color: progress !== null ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.75)',
            border: '1px solid rgba(255,255,255,0.1)',
            cursor: progress !== null ? 'not-allowed' : 'pointer',
          }}
        >
          {progress !== null ? `Uploading ${progress}%` : currentUrl ? 'Replace Image' : 'Upload Image'}
        </button>

        {/* Progress bar */}
        {progress !== null && (
          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: '#2563eb' }}
            />
          </div>
        )}

        {/* Clear button */}
        {currentUrl && progress === null && (
          <button
            type="button"
            onClick={() => { deleteStorageLogo(currentUrl); onUploaded('') }}
            className="h-11 px-3 rounded-lg text-sm font-semibold shrink-0"
            style={{ background: '#3d1515', color: '#f87171', border: '1px solid #7f1d1d' }}
          >
            ✕
          </button>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-xs" style={{ fontFamily: 'var(--font-ui)' }}>{error}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </div>
  )
}
