# Frontend Audit & Architecture Guide for Agents (FalafelUI Fork)

> **Repository**: `Falafel0/FalafelUI` (Fork of `Mooshieblob1/MooshieUI`)  
> **Target Version**: `1.0.0-falafel.1`  
> **Tech Stack**: Svelte 5 (Runes), TypeScript, Tailwind CSS 4, Tauri v2 (Rust), Embedded Axum Webserver.  
> **Audience**: AI Agents & Contributors working on the frontend codebase (`src/`).

---

## 1. Fork Context & Divergence from Upstream

FalafelUI diverged from upstream MooshieUI (`v2.3.22+`) with specialized features, customized branding, and tooling optimizations. Agents working on this repo must keep these differences in mind:

### 1.1. Fork Additions & Features
1. **Existing Installation Linking**:
   - Files: [`src/lib/components/setup/SetupWizard.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/setup/SetupWizard.svelte), [`src/lib/utils/api.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/api.ts), [`src-tauri/src/setup.rs`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src-tauri/src/setup.rs).
   - Allows users to link existing MooshieUI/ComfyUI directories (`com.mooshieui.desktop` or custom folders) without re-downloading Python, venv, or models (saving 10-50+ GB of bandwidth).
   - Commands: `detect_existing_mooshie_install`, `validate_existing_install`, `link_existing_install`.
2. **Mock Preview Harness (`?preview=...`)**:
   - Files: [`src/lib/utils/mockPreview.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/mockPreview.ts), [`src/lib/utils/ipc.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/ipc.ts).
   - Intercepts `ipcInvoke` calls via `window.__IPC_MOCK__` when the URL contains query parameters such as:
     - `?preview=main&lang=ru` — Loads main generation screen with mock models, prompts, and connection.
     - `?preview=gallery` — Gallery screen preview.
     - `?preview=settings` — Settings page preview.
     - `?preview=setup_detected` — Setup wizard detecting an existing Mooshie install.
     - `?preview=setup_custom` — Setup wizard custom folder picker.
   - Invaluable for agents and UI testing without needing a running backend.
3. **Rebranding & Falafel Theme**:
   - Files: [`src/lib/utils/theme.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/theme.ts), [`src/app.css`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/app.css).
   - Primary palette shifted from gold/indigo to violet/purple (`#a855f7`).
   - Cleaned upstream sponsor and donation links in `SettingsPage.svelte`.
4. **Build & Release Automation**:
   - Custom updater keys (`generate-keys.bat`, `scripts/apply-updater-pubkey.mjs`), standalone release scripts, and disabled external bot triage requirements.

---

## 2. Frontend Architectural Strengths (Полезные места)

### 2.1. Dual-Mode IPC Abstraction (`src/lib/utils/ipc.ts`)
- **How it works**:
  - `isTauri`: Evaluated via `!!window.__TAURI_INTERNALS__`.
  - `isBrowserMode`: Evaluated via `!isTauri && !!window.__MOOSHIE_BROWSER_MODE__`.
  - [`ipcInvoke()`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/ipc.ts#L108-L135): Automatically switches between `@tauri-apps/api/core` `invoke()` and HTTP POST `/internal-api/{command}`.
  - [`ipcListen()`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/ipc.ts#L181-L213): Automatically switches between Tauri event bus and Server-Sent Events (SSE) `/internal-api/_events`.
  - [`ipcStore`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/ipc.ts#L290-L312): Abstracts `@tauri-apps/plugin-store` (`store.json`) on desktop and `localStorage` (with per-user scoping) in browser mode.
- **Rule for agents**: **NEVER** import or call `invoke` or `listen` directly from `@tauri-apps/api`. Always import and use `ipcInvoke` and `ipcListen` from [`src/lib/utils/ipc.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/ipc.ts) or higher-level helpers in [`src/lib/utils/api.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/api.ts).

### 2.2. CSS Variable Re-mapping for Tailwind CSS 4
- In [`src/app.css`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/app.css#L48-L72), Tailwind 4 native color tokens (`--color-indigo-*`, `--color-purple-*`) are mapped to CSS custom variables (`--theme-accent-*`).
- **Benefit**: Changing themes (`falafel`, `nord`, `solarized`, `gruvbox`, `catppuccin`) dynamically re-skins all existing components without needing custom CSS overrides or modifying component class lists.

### 2.3. Modal Portaling Standard (`use:portal`)
- All overlays, lightboxes, and modals are portaled directly to `document.body` using [`src/lib/utils/portal.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/utils/portal.ts).
- Enforced by automated CI script: [`scripts/check-portals.mjs`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/scripts/check-portals.mjs).
- **Rule for agents**: Any element with `fixed inset-0` **must** have `use:portal` applied.

### 2.4. Strict Internationalization (i18n) Parity
- 11 locales managed in [`src/lib/locales/`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/locales/).
- Automated script [`scripts/check-i18n-parity.mjs`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/scripts/check-i18n-parity.mjs) blocks CI if any key or `{placeholder}` is missing or mismatched compared to `en.ts`.
- **Rule for agents**: Every new UI string must be added to all 11 locale files with exact placeholder parity.

### 2.5. Svelte 5 Runes Singletons
- State is encapsulated in class singletons inside `*.svelte.ts` files:
  - Computed values use ES class getters (`get active() { ... }`).
  - Mutable values use `#private = $state(...)` or `public = $state(...)`.
  - Avoids legacy Svelte store subscriptions (`$store`).

---

## 3. Problematic & Risky Areas (Проблемные места)

### 3.1. [CRITICAL] Memory Leaks via Missing `ipcListen` Cleanup
- **The Problem**:
  In several components, `ipcListen()` is invoked inside `onMount(async () => { ... })`:
  ```typescript
  // ANTI-PATTERN:
  onMount(async () => {
    await ipcListen("download:progress", (event: any) => { ... });
  });
  ```
  In Svelte, passing an `async` function to `onMount` returns a `Promise`. Svelte **only** executes a cleanup function if `onMount` returns a synchronous function. Therefore, the unlisten function returned by `ipcListen` is **discarded**!
  Every time the user opens/closes these panels or switches tabs, new listeners are added to `browserListeners` or the Tauri event bus and are **never garbage collected**.
- **Affected Components**:
  - [`src/lib/components/generation/ControlNetSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/ControlNetSettings.svelte#L114-L158) (`download:progress`, `install:progress`, `comfyui:controlnet_preprocessor`)
  - [`src/lib/components/generation/FaceDetectorPicker.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/FaceDetectorPicker.svelte#L59) (`download:progress`)
  - [`src/lib/components/generation/ImageEditSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/ImageEditSettings.svelte#L65) (`download:progress`)
  - [`src/lib/components/generation/SamplerSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/SamplerSettings.svelte#L112) (`download:progress`)
  - [`src/lib/components/generation/UpscaleSettings.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/generation/UpscaleSettings.svelte#L70) (`download:progress`)
  - [`src/lib/components/setup/SetupWizard.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/setup/SetupWizard.svelte#L255-L295) (`setup:progress`, `setup:log`, `download:progress`)
  - [`src/lib/components/ExternalComfyModal.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/ExternalComfyModal.svelte#L55-L62)
- **Agent Rule & Solution**:
  Always store unlisten functions and call them in `onDestroy()`:
  ```typescript
  import { onDestroy, onMount } from "svelte";
  let cleanups: Array<() => void> = [];

  onMount(() => {
    let active = true;
    ipcListen("download:progress", (event) => { ... }).then((unlisten) => {
      if (active) cleanups.push(unlisten);
      else unlisten();
    });
  });

  onDestroy(() => {
    cleanups.forEach((fn) => fn());
    cleanups = [];
  });
  ```

### 3.2. [HIGH] Svelte 5 Non-Reactive State & Prop-Capture Bugs
- **Bug 1: Non-reactive `updateObj` in Settings**:
  - Location: [`src/lib/components/settings/SettingsPage.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/settings/SettingsPage.svelte#L1148)
  - Code: `let updateObj: any | null = null;`
  - Issue: `updateObj` is modified when updates are found, and referenced in template `{#if isBrowserMode && !updateObj}` (line 4749). Because it was not declared with `$state(null)`, Svelte 5 does not track it, causing stale UI.
- **Bug 2: Local Prop Capture in Stores & State**:
  - Locations:
    - [`src/lib/artist-gallery/components/ArtistGalleryPage.svelte:51`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/artist-gallery/components/ArtistGalleryPage.svelte#L51): `const store = createArtistGalleryStore(manifestUrl);`
    - [`src/lib/artist-gallery/components/ArtistHoverPreview.svelte:15`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/artist-gallery/components/ArtistHoverPreview.svelte#L15): `const store = createArtistGalleryStore(manifestUrl);`
    - [`src/lib/components/mobile/MobileApp.svelte:35`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/mobile/MobileApp.svelte#L35): `let lastNavigationVersion = $state(navigationVersion);`
  - Issue: Passing a reactive prop directly into store instantiation only captures its initial value. If `manifestUrl` changes dynamically, the store is never updated.

### 3.3. [MEDIUM] Main Thread UI Stutter during Output Image Decoding
- Location: [`src/App.svelte:3019-3021`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/App.svelte#L3019-L3021)
- Code:
  ```typescript
  const raw = atob(data.image);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  ```
- Issue: On 4K / upscaled / 16-bit generations, `data.image` can be 10–25+ MB of base64 string. The synchronous character-by-character JavaScript loop runs on the UI main thread, causing visible frame drops or UI freezing right as generation completes.
- Solution: Prefer using the `temp_filename` endpoint (`readTempImage`) or chunked decoding.

### 3.4. [MEDIUM] Un-debounced Synchronous Disk Writes in `generation.saveSettings()`
- Location: [`src/lib/stores/generation.svelte.ts:3186`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/stores/generation.svelte.ts#L3186)
- Code:
  ```typescript
  async saveSettings() {
    if (!this._storeReady) return;
    await ipcStore.set(STORE_KEY, { ... });
  }
  ```
- Issue: In desktop mode, `ipcStore.set` calls `plugin-store.save()`, writing `store.json` to disk. `generation.saveSettings()` is called directly by tens of UI inputs, sliders, and checkboxes on change/input. Rapid interaction triggers concurrent file writes without a debounce window.

### 3.5. [HIGH] "God Objects" & Architecture Overload
- File Sizes:
  - [`src/lib/components/settings/SettingsPage.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/components/settings/SettingsPage.svelte): **5,555 lines** (~276 KB)
  - [`src/App.svelte`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/App.svelte): **4,866 lines** (~230 KB)
  - [`src/lib/stores/generation.svelte.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/stores/generation.svelte.ts): **4,365 lines** (~184 KB)
  - [`src/lib/stores/gallery.svelte.ts`](file:///c:/Users/FSD/Desktop/Mooshie-Refactor/MooshieUI/src/lib/stores/gallery.svelte.ts): **2,488 lines** (~102 KB)
- Risks for Agents:
  - Making changes in `App.svelte` or `generation.svelte.ts` has high blast radius. `generation.svelte.ts` houses txt2img, img2img, inpainting, NovelAI, video parameters, audio hooks, regional prompts, and style presets all in a single class.
  - Agents must avoid global replacements and make precise, targeted edits.

### 3.6. [LOW] Untranslated Localization Keys in `ru.ts`
- Automated check confirms 4,248 total keys, but **829 keys** in `ru.ts` are identical to `en.ts` (untranslated fallback).
- Sections with missing translations include new video acceleration settings, Suno/YuE2 music parameters, and advanced NovelAI character controls.

---

## 4. Agent Guidelines & Best Practices Checklist

When modifying or adding frontend code:

1. [ ] **IPC Calls**: Use `ipcInvoke()` and `ipcListen()` exclusively.
2. [ ] **Event Listener Cleanup**: Always store unlisten functions and call them on unmount (`onDestroy`).
3. [ ] **Reactivity in Svelte 5**:
   - Use `$state()` for any variable modified after initialization that affects the UI.
   - Do NOT use `$derived` inside `*.svelte.ts` classes (use native `get` getters).
   - Use `$derived` in `.svelte` components.
   - Do NOT capture props inside closures or store instantiations without wrapping in getters or `$effect`.
4. [ ] **Array Mutations in Stores**: Always reassign arrays (`this.items = [...this.items, newItem]`) instead of calling mutating methods (`.push()`, `.splice()`).
5. [ ] **Modals & Overlays**: Always add `use:portal` to the outermost container of any `fixed inset-0` dialog.
6. [ ] **Internationalization**: Never hardcode user-facing strings. Always use `locale.t("key")` and update all 11 locale files in `src/lib/locales/`.
7. [ ] **Pre-Commit Verification**: Run `npm run check` before submitting changes:
   ```bash
   npm run build && npm run check:i18n && npm run check:portals && npm run check:types
   ```
