import { createContext, useContext, useState, ReactNode } from "react";
import { Lang, readLang, writeLang } from "../lib/indexGuide";

// One app-wide language preference, set from the floating LanguageSwitcher and
// read by everything that shows translated content (the Performance Index
// guide, Ask Anything's summaries, and anything added later). Replaces the
// per-component pickers those two used to carry independently — one choice,
// everywhere, instead of picking English in one place and Telugu in another.
//
// Backed by the same localStorage key indexGuide.ts already used, so an
// existing preference carries over rather than resetting to English.

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    writeLang(l);
  };
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang() must be used inside <LangProvider>.");
  return ctx;
}
