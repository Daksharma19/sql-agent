import {
  streamText,
  UIMessage,
  convertToModelMessages,
  tool,
  stepCountIs,
} from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { db } from "@/db/db";

const ALLOWED_COMMANDS = ["select"];
const BLOCKED_KEYWORDS = [
  "drop",
  "truncate",
  "alter",
  "delete",
  "attach",
  "detach",
  "pragma",
  "vacuum",
  "insert",
  "update",
];

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const SYSTEM_PROMPT = `You are an expert SQL assistant that helps users to query their database using natural language.

    ${new Date().toLocaleString("sv-SE")}
    You have access to following tools:
    1. db tool - call this tool to query the database.
    2. schema tool - call this tool to get the database schema which will help you to write sql query.

Rules:
- Generate ONLY SELECT queries (no INSERT, UPDATE, DELETE, DROP)
- Always use the schema provided by the schema tool
- Pass in valid SQL syntax in db tool.
- IMPORTANT: To query database call db tool, Don't return just SQL query.

Always respond in a helpful, conversational tone while being technically accurate.`;
  const result = streamText({
    model: google("gemini-2.5-flash"),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(5),
    system: SYSTEM_PROMPT,
    tools: {
      db: tool({
        description: "Call this tool to query a database.",
        inputSchema: z.object({
          query: z.string().describe("The SQL query to ran."),
        }),
        execute: async ({ query }) => {
          console.log("Query:", query);

          if (!query || typeof query !== "string") {
            throw new Error("Invalid query");
          }

          const normalized = query.trim().toLowerCase();
          if (normalized.includes(";")) {
            throw new Error("Multiple SQL statements are not allowed");
          }

          const command = normalized.split(/\s+/)[0];
          if (!ALLOWED_COMMANDS.includes(command)) {
            throw new Error(`SQL command '${command}' is not allowed`);
          }
          for (const keyword of BLOCKED_KEYWORDS) {
            if (normalized.includes(keyword)) {
              throw new Error(`Blocked SQL keyword detected: ${keyword}`);
            }
          }

          return await db.run(query);
        },
      }),
      schema: tool({
        description: "Call this tool to get database schema information.",
        inputSchema: z.object({}),
        execute: async () => {
          return `
            CREATE TABLE products (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    price real NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    created_at text DEFAULT CURRENT_TIMESTAMP
)


CREATE TABLE sales (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    product_id integer NOT NULL,
    quantity integer NOT NULL,
    total_amount real NOT NULL,
    sale_data text DEFAULT CURRENT_TIMESTAMP,
    customer_name text NOT NULL,
    region text NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE no action ON DELETE no action
)`;
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
