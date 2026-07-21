import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  switchable: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "meetingminder-theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (!switchable) return defaultTheme;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark") return stored;
    } catch {
      // Storage can be unavailable in a locked-down WebView; fall through.
    }
    return defaultTheme;
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    (next: Theme) => {
      if (!switchable) return;
      setThemeState(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Persisting is best-effort; the in-memory theme still applies.
      }
    },
    [switchable],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      switchable,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, switchable, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside a ThemeProvider");
  }
  return context;
}
