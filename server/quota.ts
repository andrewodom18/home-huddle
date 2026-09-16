import {
  DynamoDBClient,
  TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";
import { AppError } from "./errors";

type QuotaOptions = {
  tableName?: string;
  dailyLimit?: number;
  monthlyLimit?: number;
  now?: () => Date;
  send?: (command: TransactWriteItemsCommand) => Promise<unknown>;
};

const RESERVED_CALLS = 1; // Called immediately before each Converse request.

function quotaLimit(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value !== undefined && value >= RESERVED_CALLS
    ? value
    : fallback;
}

export function createQuotaReserver(options: QuotaOptions = {}) {
  const tableName = options.tableName ?? process.env.QUOTA_TABLE_NAME;
  const dailyLimit = quotaLimit(
    options.dailyLimit ?? Number(process.env.DAILY_BEDROCK_CALL_LIMIT),
    30,
  );
  const monthlyLimit = quotaLimit(
    options.monthlyLimit ?? Number(process.env.MONTHLY_BEDROCK_CALL_LIMIT),
    300,
  );
  const now = options.now ?? (() => new Date());
  const client = options.send ? undefined : new DynamoDBClient({});
  const send = options.send ?? ((command: TransactWriteItemsCommand) => client!.send(command));

  return async () => {
    if (!tableName) {
      throw new AppError("BEDROCK_UNAVAILABLE", "The demo quota is not configured.", {
        status: 503,
      });
    }

    const date = now();
    const day = date.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const dayExpires = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 8 * 86_400;
    const [year, monthNumber] = month.split("-").map(Number);
    const monthExpires = Math.floor(Date.UTC(year, monthNumber, 1) / 1000) + 7 * 86_400;

    const update = (period: string, limit: number, expiresAt: number) => ({
      Update: {
        TableName: tableName,
        Key: { period: { S: period } },
        UpdateExpression: "SET #expiresAt = :expiresAt ADD #used :reserve",
        ConditionExpression: "attribute_not_exists(#used) OR #used <= :remaining",
        ExpressionAttributeNames: { "#used": "used", "#expiresAt": "expiresAt" },
        ExpressionAttributeValues: {
          ":reserve": { N: String(RESERVED_CALLS) },
          ":remaining": { N: String(limit - RESERVED_CALLS) },
          ":expiresAt": { N: String(expiresAt) },
        },
      },
    });

    try {
      await send(new TransactWriteItemsCommand({
        TransactItems: [
          update(`day#${day}`, dailyLimit, dayExpires),
          update(`month#${month}`, monthlyLimit, monthExpires),
        ],
      }));
    } catch (error) {
      const cancellation = error as {
        name?: string;
        CancellationReasons?: Array<{ Code?: string }>;
      };
      if (
        cancellation.name === "TransactionCanceledException" &&
        cancellation.CancellationReasons?.some((reason) => reason.Code === "ConditionalCheckFailed")
      ) {
        throw new AppError("RATE_LIMIT", "The demo's Bedrock quota is exhausted. Try again later.", {
          retryable: false,
          status: 429,
        });
      }
      throw new AppError("BEDROCK_UNAVAILABLE", "The demo quota could not be checked.", {
        retryable: true,
        status: 503,
      });
    }
  };
}
