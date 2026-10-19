import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyAppearance, readAppearance } from "./appearance";
import "./styles.css";

applyAppearance(readAppearance()); // before the first paint, so the app never flashes the default colours

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
