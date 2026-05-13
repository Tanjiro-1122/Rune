import { streamText, UIMessage, convertToCoreMessages, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { getSupabaseClient } from "@/lib/supabase";

export const maxDuration = 60;

const agentTools = {
  get_current_datetime: tool({
    description:
      "Get the current date and time. Use whenever the user asks about the date, time, day of the week, or needs time-aware information.",
    parameters: z.object({}),
    execute: async () => {
      const now = new Date();
      return {
        iso: now.toISOString(),
        readable: now.toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZoneName: "short",
        }),
      };
    },
  }),

  calculate: tool({
    description:
      "Evaluate a mathematical expression and return the result. Use for arithmetic, percentages, unit conversions, and other numeric calculations.",
    parameters: z.object({
      expression: z
        .string()
        .describe(
          "A mathematical expression, e.g. '2 + 2', '15% of 230', '(42 * 18) / 7'"
        ),
    }),
    execute: async ({ expression }) => {
      try {
        // Replace friendly aliases before whitelist check
        const safe = expression
          .trim()
          .replace(
            /\b(sqrt|log|abs|floor|ceil|round|sin|cos|tan|pow|max|min|PI|E)\b/g,
            "Math.$1"
          )
          .replace(
            /(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/gi,
            "($1 / 100) * $2"
          );

        // Allow only safe characters for math evaluation
        if (/[^0-9+\-*/().%, Math.sqrtlogabcdeifnouplwxPIE\s]/.test(safe)) {
          return { expression, error: "Expression contains invalid characters." };
        }

        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${safe})`)();

        if (typeof result !== "number" || !isFinite(result)) {
          return { expression, error: "Result is not a finite number." };
        }

        return {
          expression,
          result: Number.isInteger(result)
            ? String(result)
            : result.toPrecision(10).replace(/\.?0+$/, ""),
        };
      } catch {
        return {
          expression,
          error: "Could not evaluate expression. Use standard math notation.",
        };
      }
    },
  }),

  create_task_plan: tool({
    description:
      "Outline a numbered step-by-step plan for a complex task BEFORE starting to work on it. Always call this first for multi-step or complex requests so the user can see the roadmap.",
    parameters: z.object({
      task: z.string().describe("A concise title for the overall task"),
      steps: z
        .array(z.string())
        .describe("Ordered list of steps to accomplish the task"),
    }),
    execute: async ({ task, steps }) => ({ task, steps }),
  }),
};

export async function POST(req: Request) {
  try {
    const {
      messages,
      conversationId,
    }: { messages: UIMessage[]; conversationId?: string } = await req.json();

    const result = streamText({
      model: openai("gpt-4o-mini"),
      system: `You are Jarvis, an advanced AI super-agent. You are intelligent, capable, and methodical.

## Your Capabilities
- Answer questions and hold conversations
- Perform calculations using the \`calculate\` tool
- Check the current date/time using the \`get_current_datetime\` tool
- Plan complex tasks using the \`create_task_plan\` tool
- Analyze uploaded images and text files

## Behavior Guidelines
- For complex or multi-step requests, first call \`create_task_plan\` to show the user a clear roadmap, then execute each step
- For any arithmetic, always use the \`calculate\` tool rather than computing in your head
- For time-sensitive questions, always use \`get_current_datetime\`
- Format responses using Markdown: use **bold**, \`code\`, lists, and headers for clarity
- Be thorough yet concise. Prioritize accuracy and practical value.`,
      messages: convertToCoreMessages(messages),
      tools: agentTools,
      maxSteps: 5,
      onFinish: async ({ text }) => {
        if (!conversationId) return;
        const supabase = getSupabaseClient();
        if (!supabase) return;

        // Save the latest user message and the assistant response.
        const lastUserMessage = [...messages]
          .reverse()
          .find((m) => m.role === "user");
        if (!lastUserMessage) return;

        const userContent = lastUserMessage.parts
          .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("");

        if (!userContent || !text) return;

        await supabase.from("messages").insert([
          {
            conversation_id: conversationId,
            role: "user",
            content: userContent,
          },
          {
            conversation_id: conversationId,
            role: "assistant",
            content: text,
          },
        ]);
      },
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({ error: "Something went wrong processing your request." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
