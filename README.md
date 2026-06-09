<div align="center">

<img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platform">
<img src="https://img.shields.io/badge/AI-DeepSeek%20%7C%20Claude%20%7C%20OpenAI-green" alt="AI">
<img src="https://img.shields.io/badge/license-MIT-orange" alt="License">
<img src="https://img.shields.io/badge/cost-~¥0.0004%2F条-purple" alt="Cost">

# 🤖 闲鱼 AI 智能回复机器人

**让 AI 帮你自动回复闲鱼私信，24 小时在线接单**

<p>
<img src="https://raw.githubusercontent.com/SpicyTripe/xianyu-ai-bot/main/assets/demo.gif" width="600" alt="演示">
</p>

</div>

---

## ✨ 能做什么

| 场景 | 传统方式 | 本机器人 |
|------|----------|----------|
| 半夜来消息 | 睡醒再说，客户跑了 | 🟢 AI 秒回，留住客户 |
| 10 个人同时问 | 手忙脚乱 | 🟢 逐一回复，不混乱 |
| 对方问技术细节 | 打字慢 | 🟢 AI 专业追问，把需求聊透 |
| 对方调戏/闲聊 | 尴尬 | 🟢 不接茬，拉回技术话题 |
| 多个咨询同时聊 | 记混了 | 🟢 每人独立上下文 |

### 核心能力

- 🧠 **DeepSeek AI 驱动** — 理解需求、追问细节、展现专业
- 🔄 **连续对话记忆** — 每个客户独立上下文，不会串线
- 🛡️ **闲聊智能降频** — 遇到调戏/闲聊，自动拉回话题并降低回复频率
- 📐 **需求深挖策略** — 先聊 3-4 轮技术细节，确认需求后再让客户留微信
- 🚫 **安全红线** — 不报价、不承诺工期、不给微信号、不说"我是 AI"
- 💰 **几乎免费** — DeepSeek API 每百万 token ¥1，正常用一个月几毛钱

---

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/SpicyTripe/xianyu-ai-bot.git
cd xianyu-ai-bot
npm install
```

### 2. 配置 DeepSeek API Key

```bash
cp .env.example .env
# 编辑 .env，填入你的 DEEPSEEK_API_KEY
# 获取地址：https://platform.deepseek.com/api_keys
```

> 💡 也支持 OpenAI / Claude API，把 `bot.js` 里的 `baseURL` 改了就行。

### 3. 启动！

```bash
# 审核模式（先看 AI 回复，不发送，推荐初次使用）
node bot.js

# 全自动模式
node bot.js --auto

# 空跑测试（不操作浏览器）
node bot.js --dry-run
```

会自动打开 Edge 浏览器并跳转到闲鱼 IM 页面，扫码登录后即可开始工作。浏览器最小化就行。

---

## ⚙️ 工作流程

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  检测未读消息  │ ──→ │  提取对话上下文  │ ──→ │  DeepSeek AI │ ──→ │  自动发送回复  │
│  (1.5s 轮询)  │     │  (最近10条消息)  │     │   生成回复    │     │  (原生事件)    │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
```

### AI 回复策略

```
第1轮: 客户 "能做小程序吗？"
       AI   "可以，您需要什么类型的？电商、工具还是其他？"

第2轮: 客户 "电商的"
       AI   "电商小程序我们做的很多。需要哪些功能？商品展示、购物车、
             在线支付、订单管理？有没有参考的 App？"

第3轮: 客户 "要有购物车和支付，参考淘宝那样"
       AI   "明白了，核心是商品管理+购物车+支付，页面参考淘宝风格。
             您的目标用户量大概什么级别？这影响后端架构选择。"

第4轮: 客户 "就几千人用"
       AI   "那用微信云开发就能搞定，成本低。我总结下需求：
             电商小程序，商品展示+购物车+微信支付+订单管理，
             参考淘宝风格，用户量千人级。
             这些都对吗？对了的话麻烦留个微信，我让技术负责人加你细聊。"
```

---

## 🧪 技术原理

### 闲鱼兼容性

闲鱼网页版使用 React + Ant Design，DOM class 带有哈希后缀会随时变化。本项目使用**前缀模糊匹配选择器**，不依赖精确 hash，兼容性更好：

```js
// ❌ 硬编码（随时失效）
'.conversation-item--JReyg97P'

// ✅ 前缀匹配（兼容变化）
'[class*="conversation-item"]'
```

### 发送机制

闲鱼的 React 组件拦截了普通的 `fill()` 和按钮点击。本项目使用**原生 value setter + 事件派发**突破受控组件：

```js
// 绕过 React 受控组件
nativeSetter.call(textarea, text);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
// 派发 Enter 触发发送
textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ... }));
```

### 双策略消息检测

```
策略1: 扫描所有会话的红点 → 发现新来的消息
策略2: 直接读当前已打开对话框 → 发现已回复对象的新消息
```

---

## 📁 项目结构

```
xianyu-ai-bot/
├── bot.js              # 主程序（~400行，注释完整）
├── package.json        # 依赖管理
├── .env.example        # 环境变量模板
├── .gitignore          # git 忽略规则
├── README.md           # 本文件
├── logs/               # 对话日志（自动生成）
└── state.json          # 回复状态（自动生成）
```

---

## 🔧 配置

所有配置集中在 `bot.js` 顶部的 `CONFIG` 对象中：

```js
const CONFIG = {
  ai: {
    model: 'deepseek-chat',     // DeepSeek-V3，也支持 deepseek-reasoner
    maxTokens: 300,              // 回复最大长度
    temperature: 0.5,            // 创意度 0=保守 1=放飞
  },
  reply: {
    mode: 'auto',                // auto | review
    pollInterval: 1500,          // 轮询间隔(ms)
    maxRepliesPerDay: 50,        // 每日最大回复数
  },
};
```

---

## ❓ 常见问题

<details>
<summary><b>会被封号吗？</b></summary>
距今未收到封号报告。已做了拟人化处理（原生事件发送、不频繁操作），但目前闲鱼未明确禁止自动化客服。风险自负。
</details>

<details>
<summary><b>支持 macOS / Linux 吗？</b></summary>
支持。会自动寻找系统自带的 Edge 或 Chrome 浏览器。Windows 用 Edge，macOS 用 Chrome。
</details>

<details>
<summary><b>可以接多个闲鱼账号吗？</b></summary>
可以。复制一份到新目录，用不同的 `.browser-profile` 目录和 `.env` 文件即可。
</details>

<details>
<summary><b>能用 Claude 或 OpenAI 吗？</b></summary>
可以。项目使用 OpenAI 兼容 SDK，修改 `bot.js` 中的 `baseURL` 和 `apiKey`，改成对应的 API 即可。
</details>

---

## 📄 License

MIT © [SpicyTripe](https://github.com/SpicyTripe)

---

<div align="center">

**⭐ 如果对你有用，点个 Star 鼓励一下！**

</div>
