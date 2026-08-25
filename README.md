# openDobin

Cliente HTTP de escritorio local-first para probar APIs y webhooks. Stack: Tauri 2, React, Vite y TypeScript. Los datos viven en tu PC (`%APPDATA%/openDobin` en Windows). No hace falta cuenta.

## Requisitos

- Node.js 20+
- Rust (stable) via [rustup](https://rustup.rs)
- En Windows: Visual Studio 2022 con “Desktop development with C++” y WebView2 (incluido en Windows 10/11)

## Desarrollo

```bash
npm install
npm run tauri dev
```

Solo frontend (preview en el navegador, sin servidor de webhooks):

```bash
npm run dev
```

Abre `http://localhost:1420`. El envío HTTP usa `fetch` en el navegador (CORS puede fallar). En la app Tauri las peticiones salen por Rust (`reqwest`) y no tienen CORS.

## Build Windows

```bash
npm run tauri build
```

El instalador queda en `src-tauri/target/release/bundle/`.

## Uso rápido

1. Elige un request en **Colecciones** (hay ejemplos con `{{baseUrl}}`).
2. **Enviar** o `Ctrl+Enter`. `Ctrl+S` guarda.
3. Entornos y cURL: **Ajustes**.
4. **Webhooks**: arranca el inbox y haz `curl -X POST http://127.0.0.1:9080/hook -d "{\"ok\":true}"`.
5. **Planes** muestra Local (actual) y Pro / Empresa (próximamente).

## Arquitectura

- UI React → comandos Tauri
- Persistencia SQLite
- Entitlements en `src/core/entitlements.ts` (`can(feature)`), listos para planes cloud
- Workspaces con `id` + `kind: personal | team` para equipos más adelante
