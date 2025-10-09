# Repository Guidelines

## Project Structure & Module Organization
`wasm-core/` contains the Rust crate that unwraps OOXML archives via `inspect_ooxml`; keep helpers in `src/` and expose only the thin `#[wasm_bindgen]` entry points. The static UI lives in `web/`: `src/main.ts` wires the file picker, tree view, and preview pane, while shared styles sit in `src/style.css`. Treat `web/pkg/` as build output from `wasm-pack` and leave reusable UI fragments for future growth under `web/src/components/`.

## Build, Test, and Development Commands
From `web/`, run `pnpm install` once, then regenerate bindings with `pnpm wasm:build` (`wasm-pack build ../wasm-core --target web --out-dir ../web/pkg`). Start the playground with `pnpm dev` (ports auto-increment), ship static assets through `pnpm build`, and smoke-test them with `pnpm preview`. Run `cargo test` inside `wasm-core/` before rebuilding wasm so archive parsing stays correct.

## Coding Style & Naming Conventions
Format Rust with `rustfmt`, document exported APIs using `///`, and keep snake_case for shared identifiers (`inspect_ooxml`, `archive_summary`). TypeScript runs in strict ES2022 mode with two-space indentation; prefer descriptive filenames if you split logic out of `main.ts`. Avoid committing generated JS/wasm bundles and keep CSS utilities in plain, readable selectors.

## Testing Guidelines
Write Rust unit tests next to their modules—use in-memory archives like the `inspect_archive` test to avoid bundling sample docs. When UI behaviour expands, cover tree rendering and selection state with Vitest suites under `web/src/__tests__/`, reusing XML snippets in `web/fixtures/`. Before opening a PR, run `cargo test` and `pnpm wasm:build`; add `pnpm build` if bundler changes are involved.

## Commit & Pull Request Guidelines
Use Conventional Commits (`feat:`, `fix:`, `chore:`), describe wasm API or UI changes clearly, and attach screenshots for visual tweaks. Confirm `cargo test` and `pnpm wasm:build` in the PR body, group unrelated edits into separate reviews, and keep `web/pkg/`, `web/dist/`, and `/target` out of version control.

## Security & Configuration Tips
Install `wasm-pack` via `cargo install wasm-pack` and lock Rust toolchains with `rustup override set` when needed. Sanitise OOXML fixtures—strip personal data before committing—and treat uploads as untrusted by guarding against oversized archives and reporting parsing errors back to the UI.

## Diagnostics & Screenshots
When asked to review a screenshot, look for the most recent `截屏*.png` file on `~/Desktop/` (use `ls -t ~/Desktop`) and open it with the image viewer to understand the reported UI issue.
