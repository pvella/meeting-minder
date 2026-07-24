import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import DashboardLayout from "./components/DashboardLayout";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import ActionItems from "./pages/ActionItems";
import DailySummaries from "./pages/DailySummaries";
import DailySummaryDetail from "./pages/DailySummaryDetail";
import Home from "./pages/Home";
import MeetingDetail from "./pages/MeetingDetail";
import MeetingHistory from "./pages/MeetingHistory";
import Settings from "./pages/Settings";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path={"/"} component={Home} />
        <Route path={"/meetings"} component={MeetingHistory} />
        <Route path={"/meetings/:id"} component={MeetingDetail} />
        <Route path={"/actions"} component={ActionItems} />
        <Route path={"/days"} component={DailySummaries} />
        <Route path={"/days/:localDate"} component={DailySummaryDetail} />
        <Route path={"/settings"} component={Settings} />
        <Route path={"/404"} component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
