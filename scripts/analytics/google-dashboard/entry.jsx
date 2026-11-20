import { createRoot } from "react-dom/client";
import AnalyticsView from "../../../src/components/views/AnalyticsView.jsx";
import { withCurrentAnalyticsStatus } from "../../../src/utils/analytics.js";
import "./dashboard.css";

async function loadSnapshot(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    const finish = callback => value => {
      signal.removeEventListener("abort", abort);
      callback(value);
    };
    globalThis.google.script.run
      .withSuccessHandler(finish(result => {
        try {
          resolve(result.snapshot ? { snapshot: withCurrentAnalyticsStatus(result.snapshot) } : result);
        } catch (error) {
          reject(error);
        }
      }))
      .withFailureHandler(finish(reject))
      .readDashboardSnapshot();
  });
}

createRoot(document.getElementById("analytics-root")).render(<AnalyticsView loadSnapshot={loadSnapshot} />);
