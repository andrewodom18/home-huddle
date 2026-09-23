import { createHash, randomBytes } from "node:crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import {
  shareSnapshotSchema,
  type ShareCreateRequest,
  type ShareCreateResponse,
  type ShareResolveRequest,
  type ShareResolveResponse,
  type ShareSnapshot,
} from "../shared/shareContracts";
import { isOutdatedExample } from "../src/planStatus";
import { scheduleIssues } from "./scheduleValidation";

const SHARE_LIFETIME_SECONDS = 7 * 86_400;
const MAX_SNAPSHOT_BYTES = 64_000;
const DAY_CREATE_LIMIT = 100;
const MONTH_CREATE_LIMIT = 1_000;
const DAY_RESOLVE_LIMIT = 500;
const MONTH_RESOLVE_LIMIT = 5_000;

export class ShareError extends Error {
  readonly code: "VALIDATION" | "RATE_LIMIT" | "SHARE_NOT_FOUND" | "SHARE_UNAVAILABLE";
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: ShareError["code"],
    message: string,
    status: number,
    retryable = false,
  ) {
    super(message);
    this.name = "ShareError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

type ShareRecord = { snapshot: ShareSnapshot; expiresAt: number };

export type ShareService = {
  create: (request: ShareCreateRequest) => Promise<ShareCreateResponse>;
  resolve: (request: ShareResolveRequest) => Promise<ShareResolveResponse>;
};

type ShareOptions = {
  tableName?: string;
  requireTable?: boolean;
  now?: () => Date;
  send?: (command: GetItemCommand | TransactWriteItemsCommand) => Promise<unknown>;
};

function sha256Token(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function limitError() {
  return new ShareError("RATE_LIMIT", "The demo's sharing limit has been reached. Try again later.", 429, true);
}

function unavailableError() {
  return new ShareError("SHARE_UNAVAILABLE", "Sharing is temporarily unavailable.", 503, true);
}

function notFoundError() {
  return new ShareError("SHARE_NOT_FOUND", "This share link is unavailable or has expired.", 404);
}

function snapshotJson(snapshot: ShareSnapshot) {
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) {
    throw new ShareError("VALIDATION", "This plan is too large to share.", 413);
  }
  return json;
}

function isCheckedSnapshot(snapshot: ShareSnapshot): boolean {
  const { plan, date } = snapshot;
  if (plan.requirements?.source === "scenario" && !plan.scenarioId) return false;
  if (plan.scenarioId && isOutdatedExample(plan)) return false;
  return scheduleIssues(plan, { message: "", history: [], planDate: date }, plan.requirements).length === 0;
}

function verifiedSnapshot(request: ShareCreateRequest): ShareSnapshot {
  // Older browser-saved plans may still contain model-written, unchecked notes.
  const parsed = shareSnapshotSchema.safeParse({
    plan: { ...request.plan, notes: [] }, date: request.date, timeZone: request.timeZone,
  });
  if (!parsed.success || !isCheckedSnapshot(parsed.data)) {
    throw new ShareError("VALIDATION", "This plan has not passed schedule checks. Review it before sharing.", 400);
  }
  return parsed.data;
}

function quotaPeriods(action: "create" | "resolve", now: Date) {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  return [
    {
      key: `${action}#day#${day}`,
      limit: action === "create" ? DAY_CREATE_LIMIT : DAY_RESOLVE_LIMIT,
      expiresAt: Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 8 * 86_400,
    },
    {
      key: `${action}#month#${month}`,
      limit: action === "create" ? MONTH_CREATE_LIMIT : MONTH_RESOLVE_LIMIT,
      expiresAt: Math.floor(Date.UTC(year, monthNumber, 1) / 1000) + 8 * 86_400,
    },
  ];
}

function quotaUpdate(tableName: string, period: ReturnType<typeof quotaPeriods>[number]) {
  return {
    Update: {
      TableName: tableName,
      Key: { id: { S: `quota#${period.key}` } },
      UpdateExpression: "SET #expiresAt = :expiresAt ADD #used :one",
      ConditionExpression: "attribute_not_exists(#used) OR #used < :limit",
      ExpressionAttributeNames: { "#used": "used", "#expiresAt": "expiresAt" },
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":limit": { N: String(period.limit) },
        ":expiresAt": { N: String(period.expiresAt) },
      },
    },
  };
}

function translateDynamoError(error: unknown): ShareError {
  const failure = error as { name?: string; CancellationReasons?: Array<{ Code?: string }> };
  if (
    failure.name === "TransactionCanceledException" &&
    failure.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
  ) {
    return limitError();
  }
  return unavailableError();
}

function parseRecord(item: Record<string, AttributeValue> | undefined): ShareRecord | undefined {
  if (!item?.snapshot?.S || !item.expiresAt?.N) return undefined;
  try {
    const parsed = shareSnapshotSchema.safeParse(JSON.parse(item.snapshot.S));
    const expiresAt = Number(item.expiresAt.N);
    if (!parsed.success || !Number.isFinite(expiresAt) || !isCheckedSnapshot(parsed.data)) return undefined;
    return { snapshot: parsed.data, expiresAt };
  } catch {
    return undefined;
  }
}

export function createShareService(options: ShareOptions = {}): ShareService {
  const tableName = options.tableName ?? process.env.SHARE_TABLE_NAME;
  const now = options.now ?? (() => new Date());

  if (!tableName && options.requireTable) {
    return {
      async create() { throw unavailableError(); },
      async resolve() { throw unavailableError(); },
    };
  }

  // Local development keeps an ephemeral store; hosted Lambda requires a table.
  if (!tableName) {
    const records = new Map<string, ShareRecord>();
    const counts = new Map<string, number>();
    const reserve = (action: "create" | "resolve", date: Date) => {
      const periods = quotaPeriods(action, date);
      if (periods.some((period) => (counts.get(period.key) ?? 0) >= period.limit)) throw limitError();
      for (const period of periods) counts.set(period.key, (counts.get(period.key) ?? 0) + 1);
    };
    return {
      async create(request) {
        const snapshot = verifiedSnapshot(request);
        snapshotJson(snapshot);
        const date = now();
        reserve("create", date);
        const nowSeconds = Math.floor(date.valueOf() / 1000);
        for (const [hash, record] of records) {
          if (record.expiresAt <= nowSeconds) records.delete(hash);
        }
        const token = randomBytes(24).toString("base64url");
        const expiresAt = nowSeconds + SHARE_LIFETIME_SECONDS;
        records.set(sha256Token(token), { snapshot, expiresAt });
        return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
      },
      async resolve(request) {
        const date = now();
        reserve("resolve", date);
        const hash = sha256Token(request.token);
        const record = records.get(hash);
        if (!record || record.expiresAt <= Math.floor(date.valueOf() / 1000) || !isCheckedSnapshot(record.snapshot)) {
          records.delete(hash);
          throw notFoundError();
        }
        return { ...structuredClone(record.snapshot), expiresAt: new Date(record.expiresAt * 1000).toISOString() };
      },
    };
  }

  const client = options.send ? undefined : new DynamoDBClient({});
  const send = options.send ?? ((command: GetItemCommand | TransactWriteItemsCommand) =>
    command instanceof GetItemCommand ? client!.send(command) : client!.send(command));

  async function reserve(action: "create" | "resolve", date: Date) {
    try {
      await send(new TransactWriteItemsCommand({
        TransactItems: quotaPeriods(action, date).map((period) => quotaUpdate(tableName!, period)),
      }));
    } catch (error) {
      throw translateDynamoError(error);
    }
  }

  return {
    async create(request) {
      const snapshot = verifiedSnapshot(request);
      const json = snapshotJson(snapshot);
      const date = now();
      const token = randomBytes(24).toString("base64url");
      const expiresAt = Math.floor(date.valueOf() / 1000) + SHARE_LIFETIME_SECONDS;
      const hash = sha256Token(token);
      try {
        await send(new TransactWriteItemsCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: {
                  id: { S: `share#${hash}` },
                  snapshot: { S: json },
                  expiresAt: { N: String(expiresAt) },
                },
                ConditionExpression: "attribute_not_exists(id)",
              },
            },
            ...quotaPeriods("create", date).map((period) => quotaUpdate(tableName, period)),
          ],
        }));
      } catch (error) {
        throw translateDynamoError(error);
      }
      return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
    },
    async resolve(request) {
      const date = now();
      await reserve("resolve", date);
      let item: Record<string, AttributeValue> | undefined;
      try {
        const result = await send(new GetItemCommand({
          TableName: tableName,
          Key: { id: { S: `share#${sha256Token(request.token)}` } },
          ConsistentRead: true,
        })) as { Item?: Record<string, AttributeValue> };
        item = result.Item;
      } catch {
        throw unavailableError();
      }
      const record = parseRecord(item);
      if (!record || record.expiresAt <= Math.floor(date.valueOf() / 1000)) throw notFoundError();
      return { ...record.snapshot, expiresAt: new Date(record.expiresAt * 1000).toISOString() };
    },
  };
}
