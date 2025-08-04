export class AgentMessage {
  id?: string;
  type: string;
  content?: string;
  sender: string;
  receiver: string;
  payload?: any;
  timestamp?: number;

  constructor(sender: string, receiver: string, type: string, content?: string, id?: string, payload?: any, timestamp?: number) {
    this.id = id;
    this.type = type;
    this.content = content;
    this.sender = sender;
    this.receiver = receiver;
    this.payload = payload;
    this.timestamp = timestamp;
  }
}

/**
 * 创建智能体消息
 * @param type 消息类型
 * @param payload 消息负载
 * @param sender 发送者
 * @param receiver 接收者
 * @returns 智能体消息对象
 */
export function createAgentMessage(
  type: 'request' | 'response' | 'error',
  payload: any,
  sender: string,
  receiver: string,
  content?: string
): AgentMessage {
  const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const timestamp = Date.now();
  return new AgentMessage(sender, receiver, type, content, id, payload, timestamp);
}

/**
 * 智能体消息总线，用于智能体间通信
 */
export class MessageBus {
  private static instance: MessageBus;
  private listeners: Map<string, ((message: AgentMessage) => void)[]> = new Map();

  private constructor() {}

  /**
   * 获取消息总线单例
   */
  public static getInstance(): MessageBus {
    if (!MessageBus.instance) {
      MessageBus.instance = new MessageBus();
    }
    return MessageBus.instance;
  }

  /**
   * 发送消息
   * @param message 消息对象
   */
  public send(message: AgentMessage): void {
    const listeners = this.listeners.get(message.receiver) || [];
    listeners.forEach(listener => listener(message));
  }

  /**
   * 注册消息监听器
   * @param agentId 智能体 ID
   * @param listener 监听器函数
   */
  public subscribe(agentId: string, listener: (message: AgentMessage) => void): void {
    if (!this.listeners.has(agentId)) {
      this.listeners.set(agentId, []);
    }
    this.listeners.get(agentId)?.push(listener);
  }

  /**
   * 取消注册消息监听器
   * @param agentId 智能体 ID
   * @param listener 监听器函数
   */
  public unsubscribe(agentId: string, listener: (message: AgentMessage) => void): void {
    if (!this.listeners.has(agentId)) return;
    
    const listeners = this.listeners.get(agentId) || [];
    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
}
