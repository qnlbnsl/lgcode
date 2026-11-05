import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
