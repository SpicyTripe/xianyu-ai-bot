/**
 * 闲鱼 AI 智能回复机器人 v3
 * ==============================
 * DeepSeek 驱动的闲鱼自动客服，专为软件定制服务设计。
 *
 * 特性：
 *   - 双策略消息检测（红点 + 当前会话轮询）
 *   - 前缀模糊 DOM 选择器（兼容闲鱼 Ant Design hash 变化）
 *   - 原生 value setter 突破 React 受控组件发送
 *   - 多人独立上下文 + 闲聊智能降频
 *   - 先聊技术再要微信的策略流程
 *
 * 用法：
 *   node bot.js           # 审核模式（不发送，先看 AI 回复质量）
 *   node bot.js --auto    # 全自动模式
 *   node bot.js --dry-run # 空跑测试（不操作浏览器）
 *
 * 依赖：DeepSeek API Key（https://platform.deepseek.com/api_keys）
 *       改 .env.example 为 .env，填入 DEEPSEEK_API_KEY
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OpenAI = require('openai');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const AUTO_MODE = args.includes('--auto');

const CONFIG = {
  ai: {
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    maxTokens: 300,
    temperature: 0.5,
  },
  reply: {
    mode: AUTO_MODE ? 'auto' : 'review',
    pollInterval: 1500,
    maxRepliesPerDay: 50,
  },
  logging: { saveConversations: true, logDir: './logs' },
  stateFile: './state.json',
};

// ═══ 选择器：用子串匹配，不依赖精确 hash ═══
// 所有 evaluate 中动态 querySelector，不用固定 class
const LOG = (lv, msg, data) => {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const e = { debug:'🔍', info:'ℹ️', warn:'⚠️', error:'❌' }[lv] || '';
  console.log(`[${ts}] ${e} ${msg}`);
  if (data) console.log(data);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══ DeepSeek API ═══
const openai = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });

const SYSTEM_PROMPT = `你是闲鱼软件定制顾问，能接任何软件开发。

回复流程（严格遵守）：
1. 客户说能做啥 → 追问技术细节（平台？功能数量？有没有参考？用户量多大？后端用什么？）
2. 客户回答后 → 继续深挖 1-2 轮细节，把需求问透
3. 需求基本清晰后 → 用 2-3 句总结客户的需求，确认理解无误
4. 确认无误后 → 请客户留微信号，说"我让技术负责人加你细聊方案和报价"

关键规则：
- 永远不要主动给微信号，让客户留他们的
- 先聊 3-4 轮技术细节再提要微信
- 客户闲聊/调戏/问"你是AI吗" → 不正面回应，用技术话题拉回来，比如"哈哈，咱们还是聊聊你要做的项目吧，功能这块你有什么想法？"

频率控制：
- 如果客户连续发闲聊消息（非技术问题），只回复最新一条，前面的忽略
- 回复控制在 2-4 句，简洁专业
- 不用"亲"，不说"我是AI"，不报价不承诺工期`;

// ═══ 状态管理 ═══
class State {
  constructor(fp) {
    this.fp = fp;
    this.data = this._load();
  }
  _load() {
    try { return fs.existsSync(this.fp) ? JSON.parse(fs.readFileSync(this.fp,'utf-8')) : {}; }
    catch { return {}; }
  }
  _save() { try { fs.writeFileSync(this.fp, JSON.stringify(this.data,null,2)); } catch {} }
  _today() {
    const d = new Date().toDateString();
    if (this.data.lastReset !== d) { this.data.daily = {}; this.data.lastReset = d; }
  }
  isReplied(chatName, text) {
    const key = chatName + '_' + text.substring(0,50);
    return !!this.data.replied?.[key];
  }
  markReplied(chatName, text) {
    if (!this.data.replied) this.data.replied = {};
    this.data.replied[chatName + '_' + text.substring(0,50)] = { time: new Date().toISOString() };
    this._today();
    if (!this.data.daily) this.data.daily = {};
    this.data.daily[chatName] = (this.data.daily[chatName] || 0) + 1;
    this._save();
  }
  isDailyLimit(chatName) {
    this._today();
    return (this.data.daily?.[chatName] || 0) >= CONFIG.reply.maxRepliesPerDay;
  }
  /** 闲聊冷却：记录上次回复时间，返回还需等待的秒数 */
  cooldownRemaining(chatName) {
    if (!this.data.cooldowns) return 0;
    const last = this.data.cooldowns[chatName];
    if (!last) return 0;
    const elapsed = (Date.now() - last) / 1000;
    const need = last.isCasual ? 120 : 0; // 闲聊冷却 2 分钟
    return Math.max(0, need - elapsed);
  }
  setCooldown(chatName, isCasual) {
    if (!this.data.cooldowns) this.data.cooldowns = {};
    this.data.cooldowns[chatName] = Date.now();
    this.data._lastCasual = isCasual;
    this._save();
  }
}

// ═══ 提取消息（纯 JS，内部用子串匹配 class） ═══
async function extractMessages(page) {
  return await page.evaluate(() => {
    const results = [];

    // 找消息列表容器：class 含 "message-list-reverse"
    const list = document.querySelector('[class*="message-list-reverse"]');
    if (!list) return results;

    // 找所有消息行：class 含 "message-row"
    const rows = list.querySelectorAll('[class*="message-row"]');
    rows.forEach((row, i) => {
      // 找消息文本：class 含 "message-text--"
      const textEl = row.querySelector('[class*="message-text--"]');
      const text = textEl?.textContent?.trim() || '';
      if (!text) return;

      // 判断自己还是对方：class 含 "message-text-right" 的是自己
      const isMe = row.querySelector('[class*="message-text-right"]') !== null;

      results.push({ id: `m${i}`, text, isMe });
    });
    return results;
  });
}

// ═══ 获取未读会话 ═══
async function getUnreadConversations(page) {
  return await page.evaluate(() => {
    const items = document.querySelectorAll('[class*="conversation-item"]');
    const r = [];
    items.forEach((item, i) => {
      const unread = item.querySelector('[class*="unread-text"]');
      const badge = item.querySelector('.ant-badge');
      const hasUnread = unread || (badge && badge.textContent?.trim());
      if (hasUnread) {
        const text = item.textContent?.trim() || '';
        const badgeText = badge?.textContent?.trim() || '';
        r.push({ index: i, name: text.split('\n')[0] || text.substring(0,20), unreadCount: parseInt(badgeText)||1 });
      }
    });
    return r;
  });
}

// ═══ 获取对方名字 ═══
async function getChatName(page) {
  return await page.evaluate(() => {
    const tb = document.querySelector('[class*="message-topbar"]');
    if (!tb) return '客户';
    const t = tb.textContent?.trim() || '';
    return t.split('(')[0] || t.substring(0,30);
  });
}

// ═══ 发送消息 ═══
async function sendMessage(page, text) {
  if (DRY_RUN) { LOG('info', `[空跑] ${text}`); return true; }
  try {
    const r = await page.evaluate((text) => {
      const ta = document.querySelector('textarea');
      if (!ta) return 'no_textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true, composed:true, cancelable:true }));
      return 'sent';
    }, text);
    if (r === 'no_textarea') { LOG('error', '找不到输入框'); return false; }
    LOG('info', '✅ 已发送');
    return true;
  } catch (e) { LOG('error', `发送失败: ${e.message}`); return false; }
}

// ═══ AI 生成 ═══
async function generateReply(messages) {
  const msgs = [{ role:'system', content:SYSTEM_PROMPT }];
  for (const m of messages) {
    msgs.push({ role: m.isMe ? 'assistant' : 'user', content: `${m.isMe?'我':'客户'}: ${m.text}` });
  }
  msgs.push({ role:'user', content:'回复客户最新消息。直接给回复内容，无前缀。' });
  try {
    const resp = await openai.chat.completions.create({
      model: CONFIG.ai.model, max_tokens: CONFIG.ai.maxTokens, temperature: CONFIG.ai.temperature, messages: msgs,
    }, { timeout: 15000 });
    return resp.choices[0]?.message?.content?.trim() || '';
  } catch (e) { LOG('error', `API失败: ${e.message}`); return null; }
}

// ═══ 找 IM 页面 ═══
function findIMPage(context) {
  for (const p of context.pages()) { try { if (p.url().includes('/im')) return p; } catch {} }
  return null;
}

// ═══ 保存日志 ═══
function saveLog(buyerName, messages, reply) {
  if (!CONFIG.logging.saveConversations) return;
  const dir = CONFIG.logging.logDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fn = path.join(dir, `${Date.now()}_${buyerName.replace(/[^a-zA-Z0-9一-鿿]/g,'_').substring(0,20)}.json`);
  fs.writeFileSync(fn, JSON.stringify({ buyerName, messages, reply, time: new Date().toISOString() }, null, 2));
}

/**
 * 处理单个会话的消息
 * @returns {boolean} true 如果发送了回复
 */
async function handleConversation(page, chatInfo, state) {
  // 如果是用 index 定位的，需要点击
  if (chatInfo.index !== undefined) {
    const items = await page.$$('[class*="conversation-item"]');
    if (!items[chatInfo.index]) return false;
    await items[chatInfo.index].click();
    try { await page.waitForSelector('[class*="message-row"]', { timeout: 3000 }); } catch { return false; }
    await sleep(300);
  }

  const messages = await extractMessages(page);
  if (!messages.length) return false;

  const lastMsg = messages[messages.length - 1];
  if (lastMsg.isMe) return false;

  const chatName = await getChatName(page);
  if (state.isReplied(chatName, lastMsg.text)) return false;
  if (state.isDailyLimit(chatName)) { LOG('warn', `${chatName} 今日上限`); return false; }

  // 闲聊检测 & 冷却控制
  const casualKeywords = ['你是ai', '你是机器人', '你叫什么', '你多大了', '你是男', '你是女',
    '哈哈哈', '呵呵', '有意思', '搞笑', '无聊', 'sb', '傻逼', '垃圾', '滚', '在吗', '在么',
    '你在干嘛', '吃饭了吗', '睡觉', '天气', '你好吗', '你叫什么名字'];
  const isCasual = casualKeywords.some(kw => lastMsg.text.toLowerCase().includes(kw)) &&
    !['小程序','app','软件','系统','功能','开发','做','平台','数据','接口','爬虫',
      '网站','网页','电商','管理','微信','支付','多少钱','报价','预算'].some(
      kw => lastMsg.text.toLowerCase().includes(kw));

  const cooldown = state.cooldownRemaining(chatName);
  if (cooldown > 0) {
    LOG('debug', `冷却中，还需 ${Math.ceil(cooldown)}s`);
    return false;
  }

  const ctx = messages.slice(-10);
  LOG('info', `📩 ${chatName}: "${lastMsg.text.substring(0,50)}"`);
  LOG('info', '🤖 生成中...');
  const reply = await generateReply(ctx);
  if (!reply) return false;

  console.log('\n' + '═'.repeat(50));
  console.log(`👤 ${chatName}: ${lastMsg.text}`);
  console.log('─'.repeat(50));
  console.log(`🤖 ${reply}`);
  console.log('═'.repeat(50));

  saveLog(chatName, ctx, reply);

  if (CONFIG.reply.mode === 'auto') {
    const sent = await sendMessage(page, reply);
    if (sent) {
      state.markReplied(chatName, lastMsg.text);
      state.setCooldown(chatName, isCasual);
      return true;
    }
  } else if (DRY_RUN) {
    console.log('🔍 空跑\n');
    state.markReplied(chatName, lastMsg.text);
  } else {
    state.markReplied(chatName, lastMsg.text);
    console.log('⏳ 审核\n');
  }
  return false;
}

// ═══ 主循环 ═══
async function mainLoop(context, state) {
  LOG('info', `监控中 | ${CONFIG.reply.mode} | ${CONFIG.reply.pollInterval}ms`);

  while (true) {
    try {
      let page = findIMPage(context);
      if (!page) {
        try {
          const np = context.pages()[0] || await context.newPage();
          await np.goto('https://www.goofish.com/im', { waitUntil:'domcontentloaded', timeout:8000 });
          await sleep(1000);
          page = np;
        } catch { await sleep(CONFIG.reply.pollInterval); continue; }
      }

      // 验证页面存活
      try { await page.evaluate(() => document.title); } catch { await sleep(CONFIG.reply.pollInterval); continue; }

      // ═══ 策略1: 通过未读红点检测新会话 ═══
      const unreads = await getUnreadConversations(page);
      if (unreads.length > 0) {
        LOG('info', `📬 ${unreads.length} 个未读会话`);
        unreads.forEach(u => LOG('debug', `  ${u.name} (${u.unreadCount}条)`));
        for (const chat of unreads) {
          try { await handleConversation(page, chat, state); } catch (e) { LOG('error', `处理异常: ${e.message}`); }
        }
      }

      // ═══ 策略2: 监控当前已打开的对话（无红点但可能有新消息） ═══
      // 这是关键：回复完后会话保持打开，对方再发消息不会有红点
      try {
        await handleConversation(page, {}, state);
      } catch (e) { /* ignore */ }
    } catch (e) { LOG('error', `循环: ${e.message}`); }
    await sleep(CONFIG.reply.pollInterval);
  }
}

// ═══ 启动 ═══
async function main() {
  console.log('╔══════════════════════════════╗');
  console.log('║  闲鱼 AI 自动回复 v3       ║');
  console.log('║  模糊选择器 + 多用户支持  ║');
  console.log('╚══════════════════════════════╝\n');

  if (!process.env.DEEPSEEK_API_KEY) { console.error('❌ 缺少 DEEPSEEK_API_KEY'); process.exit(1); }

  LOG('info', `${CONFIG.ai.model} | ${DRY_RUN?'空跑':CONFIG.reply.mode}`);
  const state = new State(CONFIG.stateFile);
  const udd = path.join(__dirname, '.browser-profile');
  let context, page;

  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    context = browser.contexts()[0];
    page = findIMPage(context) || context.pages()[0];
    LOG('info', '已连接浏览器');
  } catch {
    LOG('info', '启动浏览器...');
    // 只用 Edge（系统自带，不需要额外安装 Chromium）
    const launchOpts = {
      channel: 'msedge',
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    };
    try {
      context = await chromium.launchPersistentContext(udd, launchOpts);
    } catch (e2) {
      console.error('❌ 无法启动 Edge 浏览器');
      console.error('   ' + e2.message);
      process.exit(1);
    }
    page = context.pages()[0] || await context.newPage();
  }

  if (!page.url().includes('/im')) {
    await page.goto('https://www.goofish.com/im', { waitUntil:'domcontentloaded' });
    await sleep(1000);
  }

  if (page.url().includes('login') || page.url().includes('passport')) {
    console.log('\n🔐 请扫码登录...\n');
    try { await page.waitForURL(u => !u.includes('login') && !u.includes('passport'), { timeout: 300000 });
      await page.goto('https://www.goofish.com/im', { waitUntil:'domcontentloaded' }); await sleep(1000);
    } catch { LOG('warn', '登录超时'); }
  }

  LOG('info', `📍 ${page.url()}`);

  const hasConv = await page.$('[class*="conversation-item"]').catch(() => null);
  LOG('info', `会话列表: ${hasConv?'✅':'❌'}`);
  if (!hasConv) LOG('warn', '请确认已进入 goofish.com/im');

  await mainLoop(context, state);
}

process.on('SIGINT', () => { console.log('\n👋 已停止'); process.exit(0); });
main().catch(e => { console.error(e); process.exit(1); });
