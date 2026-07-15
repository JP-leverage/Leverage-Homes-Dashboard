import React from "react";
import ReactDOM from "react-dom/client";
import App from "./LeverageHomesDashboard.jsx";

// Feed the API key from the environment into the app.
// No key -> the dashboard runs on sample data.
if (import.meta.env.VITE_SHEETS_API_KEY) {
  window.SHEETS_API_KEY = import.meta.env.VITE_SHEETS_API_KEY;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
