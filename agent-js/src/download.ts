/**
 * Enhanced Download Node with caching and validation
 *
 * This module contains the implementation of the download_node function.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState } from "./state";
import { htmlToText } from "html-to-text";
import { copilotkitEmitState } from "@copilotkit/sdk-js/langgraph";

// Import enhanced services
import { CacheManager } from "./services/cacheManager";
import { TokenValidator } from "./utils/tokenValidator";
import { SafetyFilter } from "./validation/safetyFilter";

// Initialize services
const cacheManager = new CacheManager();
const tokenValidator = new TokenValidator();
const safetyFilter = new SafetyFilter();

const RESOURCE_CACHE: Record<string, string> = {};

export function getResource(url: string): string {
  return RESOURCE_CACHE[url] || "";
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3";

async function downloadResource(url: string): Promise<string> {
  try {
    // Check cache first
    const cachedContent = await cacheManager.getCachedResourceContent(url);
    
    if (cachedContent) {
      console.log(`Using cached content for ${url}`);
      RESOURCE_CACHE[url] = cachedContent;
      return cachedContent;
    }

  const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // Increased timeout

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to download resource: ${response.statusText}`);
    }

    const htmlContent = await response.text();
    let markdownContent = htmlToText(htmlContent, {
      wordwrap: false,
      limits: {
        maxChildNodes: 100,
        maxDepth: 10,
        maxInputLength: 200
      }
    });

    // Validate content for safety
    const safetyResult = await safetyFilter.validateInput(markdownContent);
    if (!safetyResult.isValid) {
      console.warn(`Content from ${url} blocked by safety filter: ${safetyResult.issues.join(', ')}`);
      markdownContent = "Content unavailable due to safety restrictions.";
    }

    // Handle large content with token validation
    const tokenValidation = await tokenValidator.validateAndChunk(markdownContent);
    if (!tokenValidation.isValid && tokenValidation.chunks && tokenValidation.chunks.length > 0) {
      console.log(`Content from ${url} was too large (${tokenValidation.tokenCount} tokens), using chunked version with ${tokenValidation.chunks.length} chunks`);
      
      // Use the first chunk or a summary of all chunks
      markdownContent = tokenValidation.chunks[0];
      
      // Add a note about the chunking
      markdownContent += `\n\n[Note: This content was automatically shortened from ${tokenValidation.tokenCount} tokens to fit processing limits. ${tokenValidation.chunks.length} total chunks available.]`;
    }

    // Cache the processed content
    await cacheManager.cacheResourceContent(url, markdownContent);
    
    RESOURCE_CACHE[url] = markdownContent;
    return markdownContent;
    
  } catch (error) {
    console.error(`Error downloading resource ${url}:`, error);
    const errorMessage = `Error downloading resource: ${error}`;
    RESOURCE_CACHE[url] = "ERROR";
    return errorMessage;
  }
}

export async function download_node(state: AgentState, config: RunnableConfig) {
  const resources = state["resources"] || [];
  const logs = state["logs"] || [];

  const resourcesToDownload = [];
  const logsOffset = logs.length;

  // Find resources that are not downloaded
  for (const resource of resources) {
    if (!getResource(resource.url)) {
      resourcesToDownload.push(resource);
      logs.push({
        message: `Downloading ${resource.url}`,
        done: false,
      });
    }
  }

  // Emit the state to let the UI update
  const { messages, ...restOfState } = state;
  await copilotkitEmitState(config, {
    ...restOfState,
    resources,
    logs,
  });

  // Download the resources with enhanced error handling
  for (let i = 0; i < resourcesToDownload.length; i++) {
    const resource = resourcesToDownload[i];
    
    try {
      console.log(`Starting download of ${resource.url}`);
      const content = await downloadResource(resource.url);
      
      if (content && content !== "ERROR") {
        console.log(`Successfully downloaded ${resource.url} (${content.length} characters)`);
        logs[logsOffset + i]["message"] = `Downloaded ${resource.url} (${content.length} chars)`;
      } else {
        console.warn(`Failed to download ${resource.url}`);
        logs[logsOffset + i]["message"] = `Failed to download ${resource.url}`;
      }
      
    } catch (error) {
      console.error(`Download error for ${resource.url}:`, error);
      logs[logsOffset + i]["message"] = `Error downloading ${resource.url}: ${error}`;
    }
    
    logs[logsOffset + i]["done"] = true;
    
    // Emit progress update
    await copilotkitEmitState(config, {
      ...restOfState,
      resources,
      logs,
    });
  }

  return {
    resources,
    logs,
  };
}

// Export enhanced getResource function with caching
export async function getResourceCached(url: string): Promise<string> {
  const cached = getResource(url);
  if (cached && cached !== "ERROR") {
    return cached;
  }
  
  return await downloadResource(url);
}
