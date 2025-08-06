import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface LLMOptions {
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number; // 请求超时（毫秒）
  maxRetries?: number; // 失败重试次数
  baseURL?: string; // 覆盖 env 的 baseURL
}

function readNumber(envName: string, fallback?: number): number | undefined {
  const v = process.env[envName];
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 获取配置好的语言模型实例
 * @returns 语言模型实例
 */
export function getLLM(options: LLMOptions = {}): BaseChatModel {
  // 从环境变量获取 API 密钥
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY 环境变量');
  }

  // 获取自定义 API 基础 URL（如果有）
  const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL;

  // 读取可配置项（支持 env 覆盖）
  const modelName = options.modelName ?? process.env.OPENAI_MODEL ?? 'Doubao-1.5-lite-32k';
  const temperature = options.temperature ?? readNumber('OPENAI_TEMPERATURE', 0.2) ?? 0.2;
  const maxTokens = options.maxTokens ?? readNumber('OPENAI_MAX_TOKENS', 1024) ?? 1024;
  const timeout = options.timeoutMs ?? readNumber('OPENAI_TIMEOUT_MS');
  const maxRetries = options.maxRetries ?? readNumber('OPENAI_MAX_RETRIES', 2);

  // 创建 ChatOpenAI 实例
  return new ChatOpenAI({
    modelName,
    temperature, // 低温度，减少随机性，提高一致性
    maxTokens, // 最大输出 token 数
    openAIApiKey: apiKey, // 正确的属性名是 openAIApiKey，而不是 apiKey
    ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
    ...(typeof timeout === 'number' ? { timeout } : {}),
    ...(baseURL ? { configuration: { baseURL } } : {}), // 正确的配置方式
  });
}

/**
 * 获取轻量级语言模型实例，用于简单任务
 * @returns 轻量级语言模型实例
 */
export function getLightLLM(options: LLMOptions = {}): BaseChatModel {
  // 从环境变量获取 API 密钥
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY 环境变量');
  }

  // 获取自定义 API 基础 URL（如果有）
  const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL;

  // 读取可配置项（支持 env 覆盖）
  const modelName = options.modelName ?? process.env.OPENAI_LIGHT_MODEL ?? 'qwen-turbo';
  const temperature = options.temperature ?? readNumber('OPENAI_LIGHT_TEMPERATURE', 0.1) ?? 0.1;
  const maxTokens = options.maxTokens ?? readNumber('OPENAI_LIGHT_MAX_TOKENS', 512) ?? 512;
  const timeout = options.timeoutMs ?? readNumber('OPENAI_LIGHT_TIMEOUT_MS');
  const maxRetries = options.maxRetries ?? readNumber('OPENAI_LIGHT_MAX_RETRIES', 2);

  // 创建 ChatOpenAI 实例
  return new ChatOpenAI({
    modelName,
    temperature,
    maxTokens,
    openAIApiKey: apiKey, // 正确的属性名是 openAIApiKey
    ...(typeof maxRetries === 'number' ? { maxRetries } : {}),
    ...(typeof timeout === 'number' ? { timeout } : {}),
    ...(baseURL ? { configuration: { baseURL } } : {}), // 正确的配置方式
  });
}
