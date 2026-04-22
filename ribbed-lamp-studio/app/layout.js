import './globals.css'

export const metadata = {
  title: 'Ribbed Lamp Studio',
  description: 'Procedural generation of ribbed lamps',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-neutral-950">
        {children}
      </body>
    </html>
  )
}
