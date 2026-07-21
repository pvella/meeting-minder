import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Bundled rather than loaded from Google Fonts: the app is offline-first, and a
// CDN request on every launch would both delay first paint and leak usage to a
// third party.
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";

import "./index.css";

// Everything is served from the local SQLite database, so refetching on focus
// or reconnect buys nothing — the cache is only ever invalidated by our own
// mutations. Retries are off for the same reason: a local query that fails
// will fail again identically.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
