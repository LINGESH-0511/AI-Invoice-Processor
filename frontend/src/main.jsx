import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { InvoiceProvider } from "./context/InvoiceContext";

import "./index.css";

/* =========================================================
   ROOT INITIALIZATION
========================================================= */

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element (#root) not found. Make sure there is a <div id='root'></div> in your index.html");
}

/* =========================================================
   CREATE ROOT
========================================================= */

const root = ReactDOM.createRoot(rootElement);

/* =========================================================
   APP RENDER
   - StrictMode for development safety
   - Global Invoice Context Provider
========================================================= */

root.render(
  <React.StrictMode>
    <InvoiceProvider>
      <App />
    </InvoiceProvider>
  </React.StrictMode>
);

/* =========================================================
   DEVELOPMENT ONLY: HOT MODULE REPLACEMENT
========================================================= */

if (import.meta.env.DEV && import.meta.hot) {
  import.meta.hot.accept();
}

/* =========================================================
   DEVELOPMENT ONLY: STARTUP LOGGING
========================================================= */

if (import.meta.env.DEV) {
  console.log(
    "%c🚀 Invoice AI System Starting...",
    "background: #4f46e5; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;"
  );
  console.log(`📅 ${new Date().toLocaleString()}`);
  console.log(`🌍 Environment: ${import.meta.env.MODE}`);
}

/* =========================================================
   EXPORT FOR TESTING (optional)
========================================================= */

export { root };