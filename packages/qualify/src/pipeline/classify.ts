import type { NormalizedEntity } from "@registry-engine/registry-core";
import { Limiter } from "@registry-engine/registry-core";
import type { SearchIntent } from "./intent.js";
import type { TokenBudgeter } from "../llm/budgeter.js";
import { CLASSIFY_SYSTEM } from "../prompts/index.js";

const BATCH_SIZE = 30;
const CLASSIFY_CONCURRENCY = 2;
const TRADE_DESC_MAX_CHARS = 120;

export type ClassifyVerdict = "Y" | "N" | "U";

export interface ClassifyInput {
  id: string;
  name: string;
  tradeDesc: string;
}

export function buildClassifyBatch(items: ClassifyInput[], intent: SearchIntent): { system: string; user: string } {
  const system = `${CLASSIFY_SYSTEM}

Request: ${intent.query}`;

  const tsvLines = items
    .map((item, i) => `${i}\t${item.name}\t${item.tradeDesc.slice(0, TRADE_DESC_MAX_CHARS)}`)
    .join("\n");

  return { system, user: tsvLines };
}

export function parseClassifyResponse(content: string, items: ClassifyInput[]): Map<string, ClassifyVerdict> {
  const result = new Map<string, ClassifyVerdict>();
  const lines = content.trim().split("\n");

  for (const line of lines) {
    const match = line.trim().match(/^(\d+):([YNU])$/i);
    if (match) {
      const idx = parseInt(match[1] ?? "0", 10);
      const verdict = (match[2]?.toUpperCase() ?? "U") as ClassifyVerdict;
      const item = items[idx];
      if (item) {
        result.set(item.id, verdict);
      }
    }
  }

  for (const item of items) {
    if (!result.has(item.id)) {
      result.set(item.id, "U");
    }
  }

  return result;
}

export async function runClassify(
  entities: NormalizedEntity[],
  intent: SearchIntent,
  budgeter: TokenBudgeter
): Promise<Map<string, ClassifyVerdict>> {
  const limiter = new Limiter(CLASSIFY_CONCURRENCY);
  const allResults = new Map<string, ClassifyVerdict>();

  const batches: NormalizedEntity[][] = [];
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    batches.push(entities.slice(i, i + BATCH_SIZE));
  }

  const batchPromises = batches.map(batch =>
    limiter.run(async () => {
      const items: ClassifyInput[] = batch.map(e => ({
        id: e.id,
        name: e.name,
        tradeDesc: e.tradeNames[0]?.description ?? "",
      }));

      const { system, user } = buildClassifyBatch(items, intent);
      const response = await budgeter.call({
        system,
        messages: [{ role: "user", content: user }],
        maxTokens: 200,
      });

      return parseClassifyResponse(response.content, items);
    })
  );

  const batchResults = await Promise.all(batchPromises);
  for (const batchResult of batchResults) {
    for (const [id, verdict] of batchResult) {
      allResults.set(id, verdict);
    }
  }

  return allResults;
}
