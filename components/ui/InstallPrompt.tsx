'use client'
import { useEffect, useState } from 'react'

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [show, setShow]                     = useState(false)
  const [isIOS, setIsIOS]                   = useState(false)
  const [installed, setInstalled]           = useState(false)

  useEffect(() => {
    // Already running as installed PWA?
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    if (isStandalone) { setInstalled(true); return }

    // Already dismissed this session?
    if (sessionStorage.getItem('aq-install-dismissed')) return

    const ua  = navigator.userAgent
    const ios = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream
    setIsIOS(ios)

    if (ios) {
      setTimeout(() => setShow(true), 2500)
      return
    }

    // Android / Chrome / Edge — capture the install prompt
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
  }, [])

  const dismiss = () => {
    setShow(false)
    sessionStorage.setItem('aq-install-dismissed', '1')
  }

  const installNow = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    setShow(false)
    if (outcome === 'accepted') setInstalled(true)
  }

  if (!show || installed) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-5 md:bottom-5
                    md:w-[360px] z-[9999]">
      <div className="bg-[#1F4E79] rounded-2xl shadow-2xl overflow-hidden
                      border border-white/10 animate-fade-in">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center
                          justify-center text-2xl shrink-0">💧</div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-sm leading-tight">
              AquaFlow Manager
            </div>
            <div className="text-blue-300 text-xs mt-0.5">
              aqua-flow-sable.vercel.app
            </div>
          </div>
          <button onClick={dismiss}
            className="text-white/50 hover:text-white text-lg shrink-0 p-1">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-4">
          <p className="text-blue-100 text-xs leading-relaxed mb-4">
            {isIOS
              ? 'Add AquaFlow to your Home Screen for quick access — works offline too.'
              : 'Install AquaFlow on your device for instant access. Works like a native app, even offline.'}
          </p>

          {isIOS ? (
            /* iOS step-by-step */
            <div className="space-y-2.5 mb-4">
              {[
                ['1️⃣', <>Tap the <strong>Share</strong> button <span className="inline-block bg-white/20 rounded px-1 text-[11px]">⎙</span> at the bottom of Safari</>],
                ['2️⃣', <>Scroll and tap <strong>"Add to Home Screen"</strong></>],
                ['3️⃣', <>Tap <strong>"Add"</strong> — done!</>],
              ].map(([n, text], i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="text-lg shrink-0 leading-none mt-0.5">{n}</span>
                  <span className="text-white text-xs leading-relaxed">{text}</span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex gap-2">
            {!isIOS && (
              <button onClick={installNow}
                className="flex-1 py-2.5 bg-white text-[#1F4E79] font-bold text-sm
                           rounded-xl hover:bg-blue-50 active:scale-95 transition-all">
                📲  Install Now
              </button>
            )}
            <button onClick={dismiss}
              className={`py-2.5 rounded-xl text-sm transition-colors
                text-white/80 hover:text-white hover:bg-white/10 active:scale-95
                ${isIOS ? 'flex-1 bg-white/10' : 'px-4'}`}>
              {isIOS ? '✓ Got it' : 'Later'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
