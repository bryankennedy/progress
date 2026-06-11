import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Latency-spike routes (?store=query | ?store=bespoke), temporary until open
// question #4 is decided. Rendered WITHOUT StrictMode: its deliberate double
// rendering would skew the spike's render counters and paint timings.
const QuerySpike = lazy(() => import("./spike/QuerySpike"));
const BespokeSpike = lazy(() => import("./spike/BespokeSpike"));

const storeParam = new URLSearchParams(location.search).get("store");
const root = createRoot(document.getElementById("root")!);

if (storeParam === "query" || storeParam === "bespoke") {
  root.render(
    <Suspense fallback={null}>
      {storeParam === "query" ? <QuerySpike /> : <BespokeSpike />}
    </Suspense>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
