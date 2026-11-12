import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { ForwardJob } from "./types";

export function createSqsEnqueue(client: SQSClient, queueUrl: string) {
  return async (job: ForwardJob): Promise<void> => {
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(job),
      }),
    );
  };
}
