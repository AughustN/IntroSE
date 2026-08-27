import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { NavigationGuardProvider } from "./hooks/NavigationGuard";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <NavigationGuardProvider>
        <App />
      </NavigationGuardProvider>
    </BrowserRouter>
  </StrictMode>,
);
