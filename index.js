/**
 * 沈屿的记忆库 MCP Server - dyedbytheisland
 * 记忆库本地存，茶话会代理转发到 momoiseatinguuuu
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// ─── 配置 ───────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "memories.json");
const PORT = parseInt(process.env.PORT || "3000", 10);
const API_KEY = process.env.API_KEY || "";

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── 记忆存储层 ─────────────────────────────────
function loadMemories() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveMemories(memories) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(memories, null, 2), "utf-8");
}

// ─── 创建MCP服务器并注册工具 ─────────────────────
function createMcpServer() {
  const server = new McpServer({
    name: "shenyu-memory",
    version: "1.0.0",
  });

  // ── 记忆库工具 ──

  server.tool(
    "write_memory",
    "写入一条新记忆到记忆库",
    {
      content: z.string().describe("记忆内容"),
      category: z
        .enum(["deep", "daily", "diary", "writing"])
        .describe("分类：deep=深层(长期不变的设定/规则), daily=日常(最近发生的事), diary=日记(每天一篇带感情的记录), writing=写文(创作进度)"),
      tags: z.array(z.string()).optional().describe("标签列表"),
      source: z.string().optional().describe("来源说明"),
    },
    async ({ content, category, tags, source }) => {
      const memories = loadMemories();
      const memory = {
        id: randomUUID().slice(0, 8),
        content,
        category,
        tags: tags || [],
        source: source || "claude",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memories.push(memory);
      saveMemories(memories);
      return { content: [{ type: "text", text: `✅ 记忆已写入 [${memory.id}]` }] };
    }
  );

  server.tool(
    "read_memories",
    "读取记忆库中的记忆，可按分类、标签、关键词筛选",
    {
      category: z.enum(["deep", "daily", "diary", "writing"]).optional().describe("按分类筛选"),
      tag: z.string().optional().describe("按标签筛选"),
      keyword: z.string().optional().describe("按关键词搜索内容"),
      limit: z.number().optional().describe("返回数量限制，默认20"),
    },
    async ({ category, tag, keyword, limit }) => {
      let memories = loadMemories();
      if (category) memories = memories.filter((m) => m.category === category);
      if (tag) memories = memories.filter((m) => m.tags.includes(tag));
      if (keyword) memories = memories.filter((m) => m.content.toLowerCase().includes(keyword.toLowerCase()));
      memories = memories.slice(-(limit || 20));
      if (memories.length === 0) {
        return { content: [{ type: "text", text: "📭 没有找到匹配的记忆。" }] };
      }
      const text = memories
        .map((m) => `[${m.id}] <${m.category}> ${m.content}${m.tags.length ? " #" + m.tags.join(" #") : ""} (${m.createdAt.slice(0, 10)})`)
        .join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "search_memories",
    "全文搜索记忆库",
    { query: z.string().describe("搜索关键词") },
    async ({ query }) => {
      const memories = loadMemories();
      const q = query.toLowerCase();
      const results = memories.filter(
        (m) => m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q))
      );
      if (results.length === 0) {
        return { content: [{ type: "text", text: `🔍 没有找到包含「${query}」的记忆。` }] };
      }
      const text = results
        .map((m) => `[${m.id}] <${m.category}> ${m.content}${m.tags.length ? " #" + m.tags.join(" #") : ""} (${m.createdAt.slice(0, 10)})`)
        .join("\n\n");
      return { content: [{ type: "text", text: `🔍 找到 ${results.length} 条结果：\n\n${text}` }] };
    }
  );

  server.tool(
    "delete_memory",
    "删除一条记忆",
    { id: z.string().describe("要删除的记忆ID") },
    async ({ id }) => {
      const memories = loadMemories();
      const index = memories.findIndex((m) => m.id === id);
      if (index === -1) return { content: [{ type: "text", text: "❌ 未找到该ID的记忆。" }] };
      const removed = memories.splice(index, 1)[0];
      saveMemories(memories);
      return { content: [{ type: "text", text: `🗑️ 已删除记忆 [${id}]: ${removed.content.slice(0, 50)}...` }] };
    }
  );

  server.tool(
    "update_memory",
    "更新一条已有记忆",
    {
      id: z.string().describe("要更新的记忆ID"),
      content: z.string().optional().describe("新内容"),
      tags: z.array(z.string()).optional().describe("新标签列表"),
      category: z.enum(["deep", "daily", "diary", "writing"]).optional().describe("新分类"),
    },
    async ({ id, content, tags, category }) => {
      const memories = loadMemories();
      const memory = memories.find((m) => m.id === id);
      if (!memory) return { content: [{ type: "text", text: "❌ 未找到该ID的记忆。" }] };
      if (content !== undefined) memory.content = content;
      if (tags !== undefined) memory.tags = tags;
      if (category !== undefined) memory.category = category;
      memory.updatedAt = new Date().toISOString();
      saveMemories(memories);
      return { content: [{ type: "text", text: `✏️ 记忆 [${id}] 已更新。` }] };
    }
  );

  server.tool(
    "memory_stats",
    "查看记忆库的统计信息",
    {},
    async () => {
      const memories = loadMemories();
      const stats = {
        total: memories.length,
        deep: memories.filter((m) => m.category === "deep").length,
        daily: memories.filter((m) => m.category === "daily").length,
        diary: memories.filter((m) => m.category === "diary").length,
        writing: memories.filter((m) => m.category === "writing").length,
      };
      const latest = memories.length > 0 ? memories[memories.length - 1] : null;
      let text = `📊 记忆库统计\n总计: ${stats.total} 条\n深层: ${stats.deep} 条 | 日常: ${stats.daily} 条 | 日记: ${stats.diary} 条 | 写文: ${stats.writing} 条`;
      if (latest) text += `\n\n最近一条 [${latest.id}]: ${latest.content.slice(0, 60)}... (${latest.createdAt.slice(0, 10)})`;
      return { content: [{ type: "text", text }] };
    }
  );

  // ── 时间工具 ──

  server.tool(
    "get_time",
    "获取当前北京时间，沈屿每次回复易染前都会看一眼",
    {},
    async () => {
      const now = new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'long',
      });
      return { content: [{ type: "text", text: now }] };
    }
  );

  // ── AI茶话会工具（代理到 momoiseatinguuuu）──

  const SOCIAL_API_BASE = process.env.SOCIAL_API_BASE || "https://momoiseatinguuuu.zeabur.app";

  server.tool(
    "social_read",
    "读取AI茶话会的消息，看看其他AI有没有新消息",
    {
      limit: z.number().optional().describe("返回消息数量，默认20"),
    },
    async ({ limit }) => {
      try {
        const [socialRes, membersRes] = await Promise.all([
          fetch(`${SOCIAL_API_BASE}/api/social`),
          fetch(`${SOCIAL_API_BASE}/api/social/members`),
        ]);
        if (!socialRes.ok) {
          return { content: [{ type: "text", text: `❌ 茶话会读取失败：${socialRes.status}` }] };
        }
        const social = await socialRes.json();
        const members = membersRes.ok ? await membersRes.json() : {};
        const messages = (social.messages || []).slice(-(limit || 20));

        if (messages.length === 0) {
          return { content: [{ type: "text", text: "🎮 茶话会还没有消息呢，等其他AI来聊天吧！" }] };
        }

        const text = messages.map((m) => {
          const member = members[m.sender];
          const name = member?.name || m.sender;
          const time = new Date(m.timestamp).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          return `${name} (${time}):\n${m.content}`;
        }).join("\n\n");

        return { content: [{ type: "text", text: `🎮 AI茶话会消息（${messages.length}条）：\n\n${text}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `❌ 茶话会连接失败：${err.message}` }] };
      }
    }
  );

  server.tool(
    "social_post",
    "在AI茶话会发送消息，和其他AI聊天",
    {
      sender: z.string().describe("发言者ID，比如 shenyu、xiaoyu、qiuqiu"),
      content: z.string().describe("消息内容"),
    },
    async ({ sender, content }) => {
      try {
        const res = await fetch(`${SOCIAL_API_BASE}/api/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sender, content }),
        });
        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text", text: `❌ 发送失败：${res.status} ${errText}` }] };
        }
        await res.json();
        return { content: [{ type: "text", text: `消息已发送！\n\n${sender}说：${content}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `❌ 茶话会连接失败：${err.message}` }] };
      }
    }
  );

  return server;
}

// ─── Express 应用 ────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/public", express.static(path.join(__dirname, "public")));

// OAuth存储
const authCodes = new Map();
const accessTokens = new Map();
const registeredClients = new Map();

// ─── OAuth 2.0 端点 ─────────────────────────────

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const baseUrl = `https://${req.get("host")}`;
  res.json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
    code_challenge_methods_supported: ["S256"],
  });
});

app.post("/register", (req, res) => {
  const clientId = randomUUID();
  const clientSecret = randomUUID();
  registeredClients.set(clientId, { client_id: clientId, client_secret: clientSecret, redirect_uris: req.body.redirect_uris || [], client_name: req.body.client_name || "Claude" });
  res.status(201).json({ client_id: clientId, client_secret: clientSecret, redirect_uris: req.body.redirect_uris || [], client_name: req.body.client_name || "Claude" });
});

app.get("/authorize", (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, response_type } = req.query;
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>授权 - 沈屿的记忆库</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:linear-gradient(135deg,#e8f4f4,#f5efe6);color:#3a3530;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:rgba(255,253,251,0.9);border:1px solid #ddd;border-radius:16px;padding:40px;max-width:400px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08)}h1{font-size:24px;margin-bottom:8px;color:#7bb5b5}.icon{font-size:48px;margin-bottom:16px}p{color:#6b5f56;font-size:14px;line-height:1.6;margin-bottom:24px}button{background:#7bb5b5;color:#fff;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;font-weight:600}button:hover{background:#5a9a9a}</style></head><body><div class="card"><div class="icon">🏝️</div><h1>沈屿的记忆库</h1><p>Claude 请求访问记忆库<br>点击授权后即可在对话中读写记忆</p><form method="POST" action="/authorize"><input type="hidden" name="client_id" value="${client_id || ""}"><input type="hidden" name="redirect_uri" value="${redirect_uri || ""}"><input type="hidden" name="state" value="${state || ""}"><input type="hidden" name="code_challenge" value="${code_challenge || ""}"><input type="hidden" name="code_challenge_method" value="${code_challenge_method || ""}"><input type="hidden" name="response_type" value="${response_type || "code"}"><button type="submit">✅ 授权访问</button></form></div></body></html>`);
});

app.post("/authorize", (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.body;
  const code = randomUUID();
  authCodes.set(code, { client_id, redirect_uri, code_challenge, code_challenge_method, createdAt: Date.now() });
  setTimeout(() => authCodes.delete(code), 5 * 60 * 1000);
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  res.redirect(redirectUrl.toString());
});

app.post("/token", (req, res) => {
  const { grant_type, code } = req.body;
  if (grant_type === "authorization_code") {
    const authCode = authCodes.get(code);
    if (!authCode) return res.status(400).json({ error: "invalid_grant" });
    authCodes.delete(code);
    const token = randomUUID();
    accessTokens.set(token, { createdAt: Date.now() });
    return res.json({ access_token: token, token_type: "Bearer", expires_in: 86400, refresh_token: randomUUID() });
  }
  if (grant_type === "refresh_token") {
    const token = randomUUID();
    accessTokens.set(token, { createdAt: Date.now() });
    return res.json({ access_token: token, token_type: "Bearer", expires_in: 86400, refresh_token: randomUUID() });
  }
  res.status(400).json({ error: "unsupported_grant_type" });
});

// ─── Auth中间件 ─────────────────────────────────
function auth(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) return next();
  if (!API_KEY) return next();
  const key = req.headers["x-api-key"] || req.query.key;
  if (key === API_KEY) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ─── SSE Transport ──────────────────────────────
const sseTransports = new Map();

app.get("/sse", auth, async (req, res) => {
  console.log("New SSE connection");
  const transport = new SSEServerTransport("/messages", res);
  const server = createMcpServer();
  sseTransports.set(transport.sessionId, { transport, server });
  transport.onclose = () => {
    console.log("SSE closed:", transport.sessionId);
    sseTransports.delete(transport.sessionId);
  };
  await server.connect(transport);
});

app.post("/messages", auth, async (req, res) => {
  const sessionId = req.query.sessionId;
  const session = sseTransports.get(sessionId);
  if (!session) return res.status(400).json({ error: "No active SSE session" });
  await session.transport.handlePostMessage(req, res, req.body);
});

// ─── Streamable HTTP Transport ──────────────────
const streamTransports = new Map();

app.post("/mcp", auth, async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    if (sessionId && streamTransports.has(sessionId)) {
      const transport = streamTransports.get(sessionId);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    transport.onclose = () => { if (transport.sessionId) streamTransports.delete(transport.sessionId); };
    const server = createMcpServer();
    await server.connect(transport);
    if (transport.sessionId) streamTransports.set(transport.sessionId, transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/mcp", auth, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !streamTransports.has(sessionId)) return res.status(400).json({ error: "No active session" });
  await streamTransports.get(sessionId).handleRequest(req, res);
});

app.delete("/mcp", auth, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && streamTransports.has(sessionId)) {
    await streamTransports.get(sessionId).close();
    streamTransports.delete(sessionId);
  }
  res.status(200).json({ ok: true });
});

// ─── 前端页面路由 ───────────────────────────────
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/browse", (req, res) => res.sendFile(path.join(__dirname, "public", "browse.html")));

// ─── 记忆库 API ─────────────────────────────────
app.get("/api/memories", auth, (req, res) => res.json(loadMemories()));

app.post("/api/memories", auth, (req, res) => {
  const memories = loadMemories();
  const memory = { id: randomUUID().slice(0, 8), content: req.body.content || "", category: req.body.category || "daily", tags: req.body.tags || [], source: req.body.source || "web", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  memories.push(memory);
  saveMemories(memories);
  res.json(memory);
});

app.put("/api/memories/:id", auth, (req, res) => {
  const memories = loadMemories();
  const memory = memories.find((m) => m.id === req.params.id);
  if (!memory) return res.status(404).json({ error: "Not found" });
  if (req.body.content !== undefined) memory.content = req.body.content;
  if (req.body.category !== undefined) memory.category = req.body.category;
  if (req.body.tags !== undefined) memory.tags = req.body.tags;
  memory.updatedAt = new Date().toISOString();
  saveMemories(memories);
  res.json(memory);
});

app.delete("/api/memories/:id", auth, (req, res) => {
  const memories = loadMemories();
  const index = memories.findIndex((m) => m.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Not found" });
  memories.splice(index, 1);
  saveMemories(memories);
  res.json({ ok: true });
});

// ─── 启动 ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏝️ 沈屿的记忆库 running on port ${PORT}`);
  console.log(`   SSE:    GET /sse + POST /messages`);
  console.log(`   Stream: POST /mcp`);
  console.log(`   Web UI: http://localhost:${PORT}/`);
});
