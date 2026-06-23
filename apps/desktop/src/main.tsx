import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { AppQueryProvider } from "./app/query";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppQueryProvider>
      <App />
    </AppQueryProvider>
  </StrictMode>
);
