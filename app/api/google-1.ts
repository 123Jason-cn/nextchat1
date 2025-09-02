import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { getServerSideConfig } from "@/app/config/server";
import { ApiPath, GEMINI_BASE_URL, ModelProvider } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { GoogleGenAI } from "@google/genai";

const serverConfig = getServerSideConfig();

export async function handle(
  req: NextRequest,
  { params }: { params: { provider: string; path: string[] } },
) {
  console.log("[Google Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const authResult = auth(req, ModelProvider.GeminiPro);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  const bearToken =
    req.headers.get("x-goog-api-key") || req.headers.get("Authorization") || "";
  const token = bearToken.trim().replaceAll("Bearer ", "").trim();

  const apiKey = token ? token : serverConfig.googleApiKey;

  console.log('api-key google ', apiKey)

  if (!apiKey) {
    return NextResponse.json(
      {
        error: true,
        message: `missing GOOGLE_API_KEY in server env vars`,
      },
      {
        status: 401,
      },
    );
  }

  const models = params.path[params.path.length - 1].split(':')[0];
  console.log('[Google Models] ', params.path, models)

  try {
    const response = await request(req, apiKey, models);
    return response;
  } catch (e) {
    console.error("[Google] ", e);
    return NextResponse.json(prettyObject(e));
  }
}

export const GET = handle;
export const POST = handle;

export const runtime = "edge";
export const preferredRegion = [
  "bom1",
  "cle1",
  "cpt1",
  "gru1",
  "hnd1",
  "iad1",
  "icn1",
  "kix1",
  "pdx1",
  "sfo1",
  "sin1",
  "syd1",
];

async function request(req: NextRequest, apiKey: string, models: string) {
  const controller = new AbortController();

  let baseUrl = serverConfig.googleUrl || GEMINI_BASE_URL;

  let path = `${req.nextUrl.pathname}`.replaceAll(ApiPath.Google, "");

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy] ", path);
  console.log("[Base Url]", baseUrl);

  // Using @google/genai official API
  const genAI = new GoogleGenAI({ apiKey: apiKey });

  const { contents = [] } = (await req.json()) as { contents: any[] };

  console.log('[Google Gemini API Contents] ', contents)

  try {
    const result = await genAI.models.generateContentStream({
      model: models,
      contents,
    });
    console.log('[Google Gemini API Result] ', result)
    const responseStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of result) {
          console.log('[Google Gemini API Chunk] ', chunk);
          const chunkText = chunk.candidates?.at(0)?.content?.parts?.at(0)?.text || "";
          console.log('[Google Gemini API Chunk Text] ', chunkText);
          // Format as SSE
          const openaiChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Date.now(),
            model: models,
            choices: [
              {
                delta: {
                  content: chunkText,
                },
                index: 0,
                finish_reason: null,
              },
            ],
          };
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
        }
        controller.close();
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        // to prevent browser prompt for credentials
        "www-authenticate": "", // Delete this header
        // to disable nginx buffering
        "X-Accel-Buffering": "no",
      },
      status: 200,
      statusText: "OK",
    });
  } catch (e) {
    console.error("[Google API Error] ", e);
    throw e; // Re-throw the error to be caught by the handle function
  }
}
