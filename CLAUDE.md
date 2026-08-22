# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**抖音直播中控助手 v2.3.0** — 一个 Manifest V3 Chrome 扩展，在抖音直播中控台页面上注入自动化功能面板。零后端依赖，直接在页面上下文中操作 DOM 和调用页面内部 API。

**生效范围**：仅 `https://buyin.jinritemai.com/dashboard/live/control*`（直播中控页）。manifest `content_scripts.matches`、`content.js`、`inject.js`、`popup.js` 四处均按此限制，其他抖音页面一律不注入、不生效。

核心功能：
- **自动讲解** — 始终循环讲解商品；支持"打乱"模式（每轮 Fisher-Yates 随机顺序，关闭则按序号顺序）；**单商品模式**：只选 1 个商品时自动"讲解 ↔ 暂停"交替轮播；支持随机延迟和商品序号过滤（状态感知，不会把已讲解的按钮再点成"取消讲解"）
- **自动发评** — 按间隔自动发送预设评论内容到直播间公屏，支持打乱顺序
- **弹幕回复（v2.3.0 新增）** — 监听直播间实时弹幕（MutationObserver 监听聊天区 DOM），配置关键词规则（每行：`关键词1|关键词2%%回复内容`，兼容旧 `=>` 格式），命中后自动发送设定回复。**弹幕行 DOM 结构（实测）**：`commentItem` > `nickname`（含 tag 分类徽章：主播/问询/粉丝团等）+ `description`（干净内容文本）；内容从 description 提取、昵称从 nickname 去掉 tag 徽章后提取（含去尾部冒号）。内置（后台默认，不暴露 UI）：命中后延迟 1~2s、同用户冷却 60s、每分钟上限 6 条、**自动 @ 用户**（`@昵称 ` 前缀）；**主播自己（"我"/"主播我"tag）的消息直接跳过**——自动回复在弹幕区显示为"主播我"发的，由此从根上杜绝自触发循环；另有多形式指纹 60s 规避（原文+去@前缀）双保险；去重按**内容文本**（10s 窗口，解决同一弹幕被多层 DOM mutation 捕获重复回复）；串行发送队列、容器失效自愈重试；仅"包含"匹配

> 说明：改价/改库存功能已移除（存在资损风险且无法可靠操作多字段弹窗）。

## Architecture

```
popup.html/popup.js ── 弹窗入口（显示当前页面状态 + 刷新按钮）
       │
       ▼ chrome.tabs 通信
content.js ── 注入 probe.js / inject.js / panel.css 到页面
       │
       ├── 注入 probe.js ── 页面探测（拦截 fetch/XHR、扫描 Vue 实例、检测页面类型）
       │
       └── 注入 inject.js ── 主功能模块（在页面上下文中运行）
                │
                ├── PageAPI (页面连接器: 商品扫描 + 讲解按钮定位/点击 + 弹幕容器定位/提取)
                ├── AutoExplain (自动讲解模块)
                ├── AutoComment (自动发评模块)
                ├── AutoReply (弹幕关键词自动回复模块，v2.3.0)
                ├── Config (localStorage 轻量配置持久化)
                └── UIPanel (浮动控制面板，三标签：自动讲解 / 自动发评 / 弹幕回复)
```

## File Structure

| 文件 | 说明 |
|------|------|
| `manifest.json` | Manifest V3，仅中控页面权限（buyin.jinritemai.com） |
| `js/content.js` | 内容脚本，注入 probe.js → inject.js + CSS |
| `js/probe.js` | 页面探测脚本（拦截网络请求、扫描 Vue 实例、检测全局变量） |
| `js/inject.js` | **主功能文件**（PageAPI + AutoExplain + AutoComment + Config + UI） |
| `js/popup.js` | 弹窗 UI |
| `css/panel.css` | 浮动面板样式（Catppuccin 暗色主题） |
| `popup.html` | 弹窗 HTML |
| `assets/icon/logo.png` | 扩展图标（运行时唯一引用的资源） |
| `docs/research/` | 抖音页面逆向研究素材（组件名/特征文案/API 端点），非运行时 |

## Key Technical Details

- **零后端依赖**：不需要 `plug.sumlive.cn` 或其他外部服务器。脚本在页面上下文中运行，直接利用页面自身的认证状态（Cookie/Token）调用抖音内部 API
- **注入策略**：content.js 通过动态 `<script>` 标签注入 probe.js → inject.js，代码运行在页面上下文，可以直接操作 DOM 和调用页面函数
- **无后台通信**：主逻辑不依赖 Service Worker / chrome.runtime 消息（已移除未使用的消息桥接与 SSE 代理），零权限（`permissions: []`）
- **页面探测**：probe.js 拦截 fetch/XHR 请求，自动发现页面 API 端点；扫描 DOM 查找 Vue 实例；提取商品数据
- **讲解状态感知**：商品"讲解"按钮是开关式（讲解 ↔ 取消讲解），点击前先读取按钮文案，已讲解中的商品跳过不点，避免循环模式反复开关
- **DOM 引用自愈**：直播页 SPA 会频繁 re-render，商品行/按钮缓存失效时按商品名重新定位（isConnected 校验 + _locateRow 兜底）
- **UI 面板**：纯手写 CSS（无框架依赖），Catppuccin Mocha 暗色主题，左右拖动，标签页切换，可最小化
- **配置持久化**：讲解/发评的参数与评论文本保存在页面域 localStorage（`dy_*` 前缀）

## Common Tasks

- **加载扩展**：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择项目根目录
- **调试**：在目标页面 `https://buyin.jinritemai.com/dashboard/live/control` 打开 DevTools 查看 inject.js 日志（控制台前缀 `[中控助手]`）
- **修改后刷新**：在 `chrome://extensions` 中点击刷新图标重新加载
- **功能适配**：由于抖音页面结构可能更新，修改 `PageAPI` 中的 DOM 选择器即可适配
