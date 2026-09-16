import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "conversation-display-kit/styles.css";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
