import type { AgentResponseOutput as AgentResponse } from '@/types/schemas';

/**
 * Abstract base class for all agents.
 * It defines a common interface for agents to process an input and return a response.
 * @template T The type of the input object for the agent.
 */
export abstract class BaseAgent<T> {
  protected name: string;

  constructor(name: string = 'BaseAgent') {
    this.name = name;
  }

  /**
   * The main method to execute the agent's logic.
   * @param input The input data for the agent.
   * @returns A promise that resolves with the agent's response.
   */
  abstract call(input: T, signal?: AbortSignal): Promise<AgentResponse>;
}
