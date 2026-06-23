import './globals.css'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#1F4E79" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="AquaFlow" />
        <link rel="manifest" href="/manifest.json" />
        <title>AquaFlow Manager</title>
      </head>
      <body>{children}</body>
    </html>
  )
}
