<!--
Input: Alma Playwright/Chromium BiDi evidence and Cradle test/browser-use audit.
Output: Spec for Playwright/BiDi runtime management.
Position: docs/specs/alma-inspired/playwright-bidi-runtime.md
-->

# Playwright 与 BiDi Runtime

## 目标

Cradle 只有在需要超过 in-app browser-use plugin 的自动化能力时，才应把 Playwright 或 Chromium BiDi 作为产品 runtime。

## Alma 证据

Alma 依赖 `playwright` 和 `chromium-bidi`，preload 暴露 `playwright.getStatus`、`install`、install status events，并在后台安装 browsers。

## Cradle 当前状态

Cradle 用 `@playwright/test` 做测试，用 browser-use 控制 in-app browser。它没有用户可见的 Playwright install/status/runtime manager。

## Owner / Namespace

未来 browser automation owner 负责 Playwright installation、browser binaries、test/runtime separation、automation sessions。不能把产品 runtime 隐藏在 test tooling 里。

## 目标行为

- 用户可以查看 browser runtime status 并安装缺失 browsers。
- Automation sessions 声明 browser type、profile isolation、network policy、artifact retention。
- Runtime errors 要区分 missing browser binaries 与 navigation/action failures。

## API 草案

- `GET /browser-runtime/status`
- `POST /browser-runtime/install`
- `POST /browser-runtime/sessions`
- `POST /browser-runtime/sessions/:id/actions`

## 数据模型

持久化 installed runtime metadata、session records、artifact references。Browser binaries 放在平台约定 cache 目录。

## 验收

- 缺 browser dependency 时显示 install action，而不是 stack trace。
- Test Playwright dependency 与 product runtime dependency 可分离。
- Install 失败时保留 previous runtime state。
