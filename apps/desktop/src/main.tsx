import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyAppearance, readAppearance } from "./appearance";
import { attachSlidingThumbs } from "./slidingThumbs";
import { loadUnits } from "./unitsSetting";
import "./styles.css";

applyAppearance(readAppearance()); // before the first paint, so the app never flashes the default colours
loadUnits();

const root = document.getElementById("root")!;
attachSlidingThumbs(root);
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
