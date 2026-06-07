import type { Metadata, Viewport } from 'next';
import './globals.css';
import { NO_FLASH_SCRIPT, DEFAULT_THEME, DEFAULT_MODE } from '@/lib/themes';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { NexrelmProvider } from '@/components/providers/NexrelmProvider';
import { AppShell } from '@/components/shell/AppShell';

export const metadata: Metadata = {
  title: 'Nexrelm · Network Control Plane',
  description: 'One nexus for every realm of your network — DNS, DHCP, Directory, Virtualization, Security and a live network map.',
  applicationName: 'Nexrelm',
};

export const viewport: Viewport = {
  themeColor: '#16181d',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} data-mode={DEFAULT_MODE} suppressHydrationWarning>
      <head>
        {/* apply the saved theme before first paint, so there's no flash */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <NexrelmProvider>
            <AppShell>{children}</AppShell>
          </NexrelmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
