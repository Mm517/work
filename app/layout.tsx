import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kitchenly Work",
  description: "منصة خفيفة للشغل الجماعي: كود لحظي، ميتنج فيديو، ومين متصل.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
