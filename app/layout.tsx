import './globals.css'
import InstallPrompt from '@/components/ui/InstallPrompt'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#1F4E79" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="AquaFlow" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <title>AquaFlow Manager</title>
        <style>{`
          @keyframes fade-in {
            from { opacity: 0; transform: translateY(16px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in { animation: fade-in 0.3s ease-out; }
        `}</style>
      </head>
      <body>
        {children}
        <InstallPrompt />
      </body>
    </html>
  )
}
