import { Annotation } from "@langchain/langgraph";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

// Define a Resource annotation with properties for URL, title, and description
const ResourceAnnotation = Annotation.Root({
  url: Annotation<string>,
  title: Annotation<string>,
  description: Annotation<string>,
  content: Annotation<string>,
});

// Define a Log annotation with properties for message and done status
const LogAnnotation = Annotation.Root({
  message: Annotation<string>,
  done: Annotation<boolean>,
});

// Define the AgentState annotation, extending MessagesState
export const AgentStateAnnotation = Annotation.Root({
  model: Annotation<string>,
  research_question: Annotation<string>,
  report: Annotation<string>,
  resources: Annotation<(typeof ResourceAnnotation.State)[]>,
  logs: Annotation<(typeof LogAnnotation.State)[]>,
  userId: Annotation<string>,
  threadId: Annotation<string>,
  sessionId: Annotation<string>,
  performance: Annotation<{
    startTime: number;
    lastActivity: number;
    totalCost: number;
    totalTokens: number;
  }>,
  ...CopilotKitStateAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;
export type Resource = typeof ResourceAnnotation.State;
