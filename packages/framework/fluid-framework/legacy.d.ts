/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

/*
 * THIS FILE SHOULD NOT BE DELETED.
 *
 * This file is needed for compatibility with TypeScript's Node10 module resolution. In most other packages it is
 * auto-generated by `flub generate entrypoints` in @fluid-tools/build-cli, and is thus gitignored in most packages.
 *
 * However, this package is unique in that it re-exports some legacy exports from other packages directly in a source
 * file legacy.ts, and does not need to use API trimming or `flub generate entrypoints` to create the trimmed API rollup
 * files. Since `flub generate entrypoints` also creates the Node10-compatible type stubs, this file is committed
 * directly so the legacy.d.ts files produced by TypeScript itself are not overridden.
 */

export * from "./lib/legacy.js";