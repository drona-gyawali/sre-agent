// app/api/diagnose/route.ts
import { NextRequest } from "next/server";
import { runDiagnosticAgent } from "@/app/lib/agent";
import { RegistryModelId } from "@/app/lib/model.registry";

export async function POST(req: NextRequest) {
  const { message, model = "google:gemini-3.5-flash-lite" } = await req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      try {
        const agentStream = await runDiagnosticAgent(
          message,
          model as RegistryModelId
        );

        for await (const chunk of agentStream) {
          const [nodeName, update] = Object.entries(chunk)[0];
          send({ node: nodeName, update });
        }

        send({ node: "done", update: {} });
      } catch (err) {
        send({ node: "error", update: { error: String(err) } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}