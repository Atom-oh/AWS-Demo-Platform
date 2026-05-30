import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

export async function ensureStateTable(client: DynamoDBClient, tableName: string): Promise<void> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch {
    // not exists, ok
  }
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    }),
  );
}
