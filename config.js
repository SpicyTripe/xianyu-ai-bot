/**
 * 闲鱼 AI 回复机器人 - 配置文件
 *
 * 使用前请根据实际情况修改以下配置
 */

module.exports = {
  // ========== 浏览器配置 ==========
  browser: {
    // Chrome 调试端口（启动 Chrome 时需要加 --remote-debugging-port=9222）
    cdpPort: 9222,
    // 闲鱼消息页面 URL（打开后停留在消息列表页即可）
    xianyuMessagesUrl: 'https://www.goofish.com',
    // 如果闲鱼 IM 是独立页面，改为对应 URL
    // xianyuMessagesUrl: 'https://www.goofish.com/im',
  },

  // ========== AI 配置 ==========
  ai: {
    // DeepSeek API 配置（兼容 OpenAI SDK）
    // 获取 Key: https://platform.deepseek.com/api_keys
    // 模型选择：
    //   - deepseek-chat:     DeepSeek-V3，性价比最高（¥1/百万token），推荐
    //   - deepseek-reasoner: DeepSeek-R1，推理更强，但回复较慢
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    // 最大输出 token 数
    maxTokens: 300,
    // 温度，0.3-0.7 之间
    temperature: 0.5,
  },

  // ========== 回复策略 ==========
  reply: {
    // 模式: 'auto' = 全自动发送, 'review' = 生成草稿等人工确认
    mode: 'review',
    // 轮询间隔（毫秒），检测新消息的频率
    pollInterval: 3000,
    // 两次回复之间的最小间隔（毫秒），防止触发风控
    minReplyInterval: 5000,
    // 每个会话每天最多自动回复次数
    maxRepliesPerDay: 20,
    // 忽略自己的消息（自己发出的不触发回复）
    ignoreOwnMessages: true,
  },

  // ========== 闲鱼页面 DOM 选择器 ==========
  // 注意：闲鱼可能随时改版，这些选择器需要根据实际情况调整
  selectors: {
    // 消息列表项（未读消息通常有特殊 class 或 badge）
    chatListItem: '[class*="chat-item"], [class*="conversation"], [class*="session"]',
    // 未读消息标记
    unreadBadge: '[class*="unread"], [class*="badge"], .unread-count',
    // 聊天消息容器
    messageList: '[class*="message-list"], [class*="chat-content"], [class*="msg-list"]',
    // 单条消息
    messageItem: '[class*="message-item"], [class*="msg-item"], [class*="bubble"]',
    // 消息文本内容
    messageText: '[class*="message-text"], [class*="msg-text"], [class*="content"]',
    // 输入框
    inputBox: 'textarea, [contenteditable="true"], [class*="input"] textarea',
    // 发送按钮
    sendButton: '[class*="send"], button[type="submit"], [class*="send-btn"]',
    // 发送者名称（用于区分自己/对方）
    senderName: '[class*="sender"], [class*="nickname"], [class*="name"]',
  },

  // ========== 日志配置 ==========
  logging: {
    level: 'info', // 'debug' | 'info' | 'warn' | 'error'
    saveConversations: true, // 是否保存对话日志
    logDir: './logs',
  },

  // ========== 状态持久化 ==========
  stateFile: './state.json',
};
