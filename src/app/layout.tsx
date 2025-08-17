import type { Metadata } from 'next';
import './globals.scss';
import NavBar from '@/components/NavBar';

export const metadata: Metadata = {
  title: 'AI中文文本检测工具',
  description: '智能检测中文文本的语法、拼写、标点符号、流畅等问题',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
