"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "financehub:privacy-mode";

type PrivacyContextValue = {
  isPrivate: boolean;
  togglePrivate: () => void;
};

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    setIsPrivate(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  function togglePrivate() {
    setIsPrivate((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return <PrivacyContext.Provider value={{ isPrivate, togglePrivate }}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used within a PrivacyProvider");
  return ctx;
}
