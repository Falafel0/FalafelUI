import "./app.css";
import { installConsoleInterceptor } from "./lib/utils/log-buffer.js";
import App from "./App.svelte";
import { mount } from "svelte";

import { initMockPreview } from "./lib/utils/mockPreview.js";

// Install before mounting so startup logs are captured.
installConsoleInterceptor();
initMockPreview();

const app = mount(App, { target: document.getElementById("app")! });

export default app;
