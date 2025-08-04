import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * 获取配置好的语言模型实例
 * @returns 语言模型实例
 */
export function getLLM(): BaseChatModel {
  // 从环境变量获取 API 密钥
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY 环境变量');
  }

  // 获取自定义 API 基础 URL（如果有）
  const baseURL = process.env.OPENAI_BASE_URL;

  // 创建 ChatOpenAI 实例，使用 gpt-4 模型
  return new ChatOpenAI({
    modelName: 'Doubao-vision-pro-32k',
    temperature: 0.2, // 低温度，减少随机性，提高一致性
    maxTokens: 1024, // 最大输出 token 数
    openAIApiKey: apiKey, // 正确的属性名是 openAIApiKey，而不是 apiKey
    ...(baseURL ? { configuration: { baseURL } } : {}), // 正确的配置方式
  });
}

/**
 * 获取轻量级语言模型实例，用于简单任务
 * @returns 轻量级语言模型实例
 */
export function getLightLLM(): BaseChatModel {
  // 从环境变量获取 API 密钥
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('未配置 OPENAI_API_KEY 环境变量');
  }

  // 获取自定义 API 基础 URL（如果有）
  const baseURL = process.env.OPENAI_BASE_URL;

  // 创建 ChatOpenAI 实例，使用 gpt-4 模型
  return new ChatOpenAI({
    modelName: 'Doubao-vision-pro-32k',
    temperature: 0.1,
    maxTokens: 512,
    openAIApiKey: apiKey, // 正确的属性名是 openAIApiKey
    ...(baseURL ? { configuration: { baseURL } } : {}), // 正确的配置方式
  });
}
