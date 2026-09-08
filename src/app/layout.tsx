import type { Metadata } from "next";
import { Cormorant_Garamond, Lora } from "next/font/google";
import { AuthGate } from "@/components/auth-gate";
import { PrivacyProvider } from "@/lib/privacy-context";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "600"],
});

const lora = Lora({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "FinanceHub",
  description: "Private, locally-run finance tracking web app",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${cormorant.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <PrivacyProvider>
          <AuthGate>{children}</AuthGate>
        </PrivacyProvider>
      </body>
    </html>
  );
}
