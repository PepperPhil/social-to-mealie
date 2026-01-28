import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import type React from 'react';

export const metadata = {
  title: 'Social to Mealie',
  description: 'Convert social media recipes to Mealie format',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#111111" />
        <link rel="icon" href="/file.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
