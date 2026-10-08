export type ServiceUsage = { costMicros: number; calls: number };

export type InstanceUsage = {
  period: string;
  totalMicros: number;
  byIntegration: {
    llm: ServiceUsage & { inputTokens: number; outputTokens: number };
    brave: ServiceUsage;
    composio: ServiceUsage;
    perflo: ServiceUsage;
  };
};
