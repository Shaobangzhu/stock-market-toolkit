import type { ReactNode } from 'react';
import { useState } from 'react';
import { ConfigProvider, theme } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: false },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#4a8dff',
          colorBgBase: '#081322',
          colorBgContainer: '#101e31',
          colorBorder: '#263950',
          colorText: '#ebf3ff',
          colorTextSecondary: '#a5b5c9',
          borderRadius: 12,
          fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Button: { controlHeight: 40 },
          Input: { controlHeight: 42 },
          Card: { borderRadiusLG: 18 },
        },
      }}>
        {children}
      </ConfigProvider>
    </QueryClientProvider>
  );
}
