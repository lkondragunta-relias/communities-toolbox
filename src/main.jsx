import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/roadmap.css";
import App from "./App.jsx";
import SiteAccessGate from "./components/SiteAccessGate.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SiteAccessGate>
      <App />
    </SiteAccessGate>
  </StrictMode>
);
