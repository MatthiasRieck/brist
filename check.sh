#!/usr/bin/env bash
set -euo pipefail

echo "=== TypeScript type check ==="
pnpm typecheck

echo ""
echo "=== ESLint ==="
pnpm lint

echo ""
echo "=== Frontend tests ==="
pnpm test

echo ""
echo "=== Rust format check ==="
cargo fmt --manifest-path src-tauri/Cargo.toml --check

echo ""
echo "=== Rust lint (clippy) ==="
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

echo ""
echo "=== Rust tests ==="
cargo test --manifest-path src-tauri/Cargo.toml

echo ""
echo "All checks passed!"
