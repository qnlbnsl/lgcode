import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

import { initializeTheme } from "./shell/preferences.ts";

initializeTheme();
const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
