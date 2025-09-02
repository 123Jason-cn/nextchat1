import { ApiPath, Google } from "@/app/constant";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  LLMUsage,
  SpeechOptions,
} from "../api";
import {
  useAccessStore,
  useAppConfig,
  useChatStore,
  usePluginStore,
  ChatMessageTool,
} from "@/app/store";
import { stream } from "@/app/utils/chat";
import { getClientConfig } from "@/app/config/client";
import { GEMINI_BASE_URL } from "@/app/constant";

import {
  getMessageTextContent,
  getMessageImages,
  isVisionModel,
  getTimeoutMSByModel,
} from "@/app/utils";
import { preProcessImageContent } from "@/app/utils/chat";
import { nanoid } from "nanoid";
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import { create } from "zustand";

function openaiParseSSE(text: string, runTools: ChatMessageTool[]): string | undefined {
  const chunkJson = JSON.parse(text);
  const choices = chunkJson.choices;
  const delta = choices?.at(0)?.delta;

  if (delta?.content) {
    return delta.content;
  } else if (delta?.tool_calls?.length > 0) {
    for (const toolCall of delta.tool_calls) {
      runTools.push({
        id: nanoid(),
        type: "function",
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      });
    }
  }
  return undefined;
}

function processToolMessage(
  requestPayload: RequestPayload,
  toolCallMessage: any,
  toolCallResult: any[],
) {
  // @ts-ignore
  requestPayload?.contents?.splice(
    // @ts-ignore
    requestPayload?.contents?.length,
    0,
    {
      role: "model",
      parts: toolCallMessage.tool_calls.map(
        (tool: ChatMessageTool) => ({
          functionCall: {
            name: tool?.function?.name,
            args: JSON.parse(tool?.function?.arguments as string),
          },
        }),
      ),
    },
    // @ts-ignore
    ...toolCallResult.map((result) => ({
      role: "function",
      parts: [
        {
          functionResponse: {
            name: result.name,
            response: {
              name: result.name,
              content: result.content, // TODO just text content...
            },
          },
        },
      ],
    })),
  );
}

interface GeminiApiState {
  getAccessState: typeof useAccessStore.getState;
  getAppConfigState: typeof useAppConfig.getState;
  getChatStoreState: typeof useChatStore.getState;
  getPluginStoreState: typeof usePluginStore.getState;
}

export class GeminiProApi implements LLMApi {
  private readonly getState: GeminiApiState;

  constructor(getState: GeminiApiState) {
    this.getState = getState;
  }

  path(path: string, shouldStream = false): string {
    const accessStore = this.getState.getAccessState();

    let baseUrl = "";
    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.googleUrl;
    }

    const isApp = !!getClientConfig()?.isApp;
    if (baseUrl.length === 0) {
      baseUrl = isApp ? GEMINI_BASE_URL : ApiPath.Google;
    }
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.Google)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);
    console.log("[Google API] Final baseUrl: ", baseUrl);
    console.log("[Google API] Final chatPath segment: ", path);

    let chatPath = [baseUrl, path].join("/");
    if (shouldStream) {
      chatPath += chatPath.includes("?") ? "&alt=sse" : "?alt=sse";
    }
    console.log("[Google API] Constructed chatPath: ", chatPath);

    return chatPath;
  }
  extractMessage(res: any) {
    console.log("[Response] gemini-pro response: ", res);

    if (Array.isArray(res)) {
      // For Gemini, when not streaming, the response is an array
      // of `GenerateContentResponse` objects.
      // It's not clear how the API handles tool calls when not streaming.
      // So we just take the last message in the array
      return res.at(0)?.choices?.at(0)?.message?.content || (res.at(0) as any)?.error?.message || "";
    }
    return res?.choices?.at(0)?.message?.content || res.error?.message || "";
  }
  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions): Promise<void> {
    const apiClient = this;
    let multimodal = false;

    // try get base64image from local cache image_url
    const _messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      const content = await preProcessImageContent(v.content);
      _messages.push({ role: v.role, content });
    }
    const messages = _messages.map((v) => {
      let parts: any[] = [{ text: getMessageTextContent(v) }];
      if (isVisionModel(options.config.model)) {
        const images = getMessageImages(v);
        if (images.length > 0) {
          multimodal = true;
          parts = parts.concat(
            images.map((image) => {
              const imageType = image.split(";")[0].split(":")[1];
              const imageData = image.split(",")[1];
              return {
                inline_data: {
                  mime_type: imageType,
                  data: imageData,
                },
              };
            }),
          );
        }
      }
      return {
        role: v.role.replace("assistant", "model").replace("system", "user"),
        parts: parts,
      };
    });

    // google requires that role in neighboring messages must not be the same
    for (let i = 0; i < messages.length - 1; ) {
      // Check if current and next item both have the role "model"
      if (messages[i].role === messages[i + 1].role) {
        // Concatenate the 'parts' of the current and next item
        messages[i].parts = messages[i].parts.concat(messages[i + 1].parts);
        // Remove the next item
        messages.splice(i + 1, 1);
      } else {
        // Move to the next item
        i++;
      }
    }
    // if (visionModel && messages.length > 1) {
    //   options.onError?.(new Error("Multiturn chat is not enabled for models/gemini-pro-vision"));
    // }

    const accessStore = this.getState.getAccessState();

    const modelConfig = {
      ...this.getState.getAppConfigState().modelConfig,
      ...this.getState.getChatStoreState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
      },
    };
    const requestPayload = {
      contents: messages,
      generationConfig: {
        // stopSequences: [
        //   "Title"
        // ],
        temperature: modelConfig.temperature,
        maxOutputTokens: modelConfig.max_tokens,
        topP: modelConfig.top_p,
        // "topK": modelConfig.top_k,
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: 'BLOCK_NONE',
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: 'BLOCK_NONE',
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: 'BLOCK_NONE',
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: 'BLOCK_NONE',
        },
      ],
    };

    let shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);
    try {
      // https://github.com/google-gemini/cookbook/blob/main/quickstarts/rest/Streaming_REST.ipynb
      const chatPath = this.path(
        Google.ChatPath(modelConfig.model),
        shouldStream,
      );

      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      const isThinking = options.config.model.includes("-thinking");
      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(options.config.model),
      );

      if (shouldStream) {
        const [tools, funcs] = this.getState.getPluginStoreState()
          .getAsTools(
            this.getState.getChatStoreState().currentSession().mask?.plugin || [],
          );
        return stream(
          chatPath,
          requestPayload,
          getHeaders(),
          // @ts-ignore
          tools.length > 0
            ? // @ts-ignore
              [{ functionDeclarations: tools.map((tool) => tool.function) }]
            : [],
          funcs,
          controller,
          openaiParseSSE, // parseSSE
          processToolMessage, // Use the existing processToolMessage
          options,
          this.getState.getChatStoreState(),
        );
      } else {
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);
        const resJson = await res.json();
        if (resJson?.promptFeedback?.blockReason) {
          // being blocked
          options.onError?.(
            new Error(
              "Message is being blocked for reason: " +
                resJson.promptFeedback.blockReason,
            ),
          );
        }
        const message = apiClient.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  usage(): Promise<LLMUsage> {
    throw new Error("Method not implemented.");
  }
  async models(): Promise<LLMModel[]> {
    return [];
  }
}
