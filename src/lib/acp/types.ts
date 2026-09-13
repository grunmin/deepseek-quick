/**
 * ACP（Agent Client Protocol）线上类型的最小闭包。
 *
 * 只声明本扩展**真正读到**的字段。ACP 的 schema 很大、而且还在演进（elicitation 至今
 * 标着 UNSTABLE），把整份 schema 抄进来只会变成维护负担；换一个 agent（codex 等）时
 * 字段只会更少，所以这里所有字段一律可缺席，渲染层必须能降级。
 *
 * 事实来源是本机装的 `@agentclientprotocol/sdk@1.3.0/schema/schema.json`。
 */

/** 一轮 prompt 的结束原因；认不出的值原样保留，不要当错误 */
export type StopReason = string;

export interface PermissionOptionWire {
  optionId: string;
  name: string;
  /** allow_once | allow_always | reject_once | reject_always */
  kind?: string;
}

export interface ToolCallContentWire {
  /** content（普通文本/图片） | diff | terminal */
  type: string;
  text?: string;
  path?: string;
  oldText?: string | null;
  newText?: string;
  terminalId?: string;
}

export interface ToolCallWire {
  toolCallId: string;
  /** 工具名（bash / write / read …），会随 update 补齐 */
  name?: string | null;
  /** 人类可读的摘要，dsh 会给出模型自己写的意图描述 */
  title?: string | null;
  /** read | edit | execute | search | fetch | think | other */
  kind?: string | null;
  /** pending | in_progress | completed | failed */
  status?: string | null;
  content?: ToolCallContentWire[] | null;
  locations?: { path?: string }[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
  _meta?: Record<string, unknown> | null;
}

export interface ContentChunkWire {
  /** 文本块；按 ACP 规范也可能是图片等，这里只认 text */
  content?: { type?: string; text?: string } | null;
  messageId?: string | null;
}

export interface UsageUpdateWire {
  used?: number;
  size?: number;
  _meta?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheHitRate?: number;
    tps?: number;
    turnCount?: number;
    /** 工具耗时等，dsh 用毫秒 */
    elapsedMs?: number;
  } | null;
}

export interface SessionInfoUpdateWire {
  title?: string | null;
  updatedAt?: string | null;
}

export interface AvailableCommandWire {
  name: string;
  description?: string | null;
  input?: { hint?: string | null } | null;
}

export interface SessionInfoWire {
  sessionId: string;
  cwd?: string;
  title?: string | null;
  updatedAt?: string | null;
}

export interface SessionConfigChoiceWire {
  value: string;
  name: string;
  description?: string | null;
}

/** 选择项可以分组（dsh 的模型目录就是 provider 分组），也可以平铺 */
export interface SessionConfigGroupWire {
  group: string;
  name: string;
  options: SessionConfigChoiceWire[];
}

export interface SessionConfigOptionWire {
  id: string;
  name: string;
  description?: string | null;
  /** model | thought_level | mode | model_config | plan …语义标签，只影响展示 */
  category?: string | null;
  /** 已知取值：select（带 options）；boolean / 其它按不可编辑处理 */
  type?: string | null;
  currentValue?: string | boolean | null;
  options?: (SessionConfigChoiceWire | SessionConfigGroupWire)[] | null;
}

export interface SessionModeWire {
  id: string;
  name: string;
  description?: string | null;
}

export interface SessionModeStateWire {
  currentModeId?: string;
  availableModes?: SessionModeWire[];
}

export interface AgentCapabilitiesWire {
  loadSession?: boolean;
  promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
  sessionCapabilities?: { list?: unknown; delete?: unknown; close?: unknown };
}

/**
 * `session/update` 里的 update 载荷。
 *
 * 不写成严格联合：agent 会不断加新 sessionUpdate 类型，写死联合会让「多一个字段就编译不过」。
 * 未知类型由渲染层忽略即可。
 */
export interface SessionUpdateWire {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface PermissionRequestWire {
  sessionId: string;
  /**
   * ⚠️ 线上只带 `toolCallId`，**不带**工具详情 —— 客户端必须自己按 id 回查刚才那条
   * `tool_call`，否则审批对话框里只有一个裸 id，用户根本不知道自己在批准什么。
   */
  toolCall?: { toolCallId: string } | null;
  options: PermissionOptionWire[];
}
