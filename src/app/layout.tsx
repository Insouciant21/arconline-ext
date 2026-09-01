import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arcaea B50 Studio",
  description: "Arcaea B50 与潜力值图片归档面板",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700&family=Open+Sans:wght@400;700&family=Titillium+Web:wght@400;600;700&family=Exo:wght@700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
