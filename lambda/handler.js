// Feature: dynamodb-leaderboard-amplify-deploy
// Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 5.2, 5.3, 5.5

import { DynamoDBClient, QueryCommand, PutItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';

const dynamoClient = new DynamoDBClient({});

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

/**
 * Builds CORS headers for a given request origin.
 * If requestOrigin matches ALLOWED_ORIGIN exactly, the origin is echoed back.
 * Otherwise an empty string is used so the browser will block the response.
 *
 * @param {string|undefined} requestOrigin - The Origin header value from the incoming request.
 * @returns {Record<string, string>} CORS headers object.
 */
function buildCorsHeaders(requestOrigin) {
  const origin = requestOrigin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * Handles OPTIONS preflight requests.
 * Returns 204 No Content with CORS headers.
 *
 * @param {object} event - API Gateway Lambda proxy event.
 * @returns {object} Lambda proxy response.
 */
async function handleOptions(event) {
  const requestOrigin = event.headers?.Origin || event.headers?.origin;
  return {
    statusCode: 204,
    headers: buildCorsHeaders(requestOrigin),
    body: '',
  };
}

/**
 * Handles GET /scores.
 * Queries the GSI gameId-score-index for the top 10 global scores in descending order.
 *
 * @param {object} event - API Gateway Lambda proxy event.
 * @returns {object} Lambda proxy response with the top-10 scores array.
 */
async function handleGet(event) {
  const requestOrigin = event.headers?.Origin || event.headers?.origin;
  try {
    // Paginate through all items — no Limit so every registered score is returned.
    const allItems = [];
    let lastEvaluatedKey = undefined;

    do {
      const queryParams = {
        TableName: process.env.TABLE_NAME || 'torre-nubes-scores',
        IndexName: 'gameId-score-index',
        KeyConditionExpression: 'gameId = :g',
        ExpressionAttributeValues: { ':g': { S: 'global' } },
        ScanIndexForward: false,
      };

      if (lastEvaluatedKey) {
        queryParams.ExclusiveStartKey = lastEvaluatedKey;
      }

      const result = await dynamoClient.send(new QueryCommand(queryParams));
      if (result.Items) {
        allItems.push(...result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    const items = allItems.map((item) => ({
      id: item.id.S,
      name: item.name?.S || '',
      score: Number(item.score.N),
      timestamp: item.timestamp.S,
    }));

    return {
      statusCode: 200,
      headers: buildCorsHeaders(requestOrigin),
      body: JSON.stringify(items),
    };
  } catch (err) {
    console.error('handleGet error:', err);
    return {
      statusCode: 500,
      headers: buildCorsHeaders(requestOrigin),
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * Handles POST /scores.
 * Validates the request body and persists the score item to DynamoDB.
 * Always overwrites any incoming gameId with "global".
 *
 * Validation rules:
 *   - id:        string, 1–100 characters
 *   - score:     integer in [0, 999999999]
 *   - timestamp: non-empty string
 *
 * @param {object} event - API Gateway Lambda proxy event.
 * @returns {object} Lambda proxy response.
 */
async function handlePost(event) {
  const requestOrigin = event.headers?.Origin || event.headers?.origin;
  const corsHeaders = buildCorsHeaders(requestOrigin);

  // 1. Parse body JSON
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_err) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  // 2. Validate id: must be string, length 1–100
  const { id, score, timestamp } = body;
  if (typeof id !== 'string' || id.length < 1 || id.length > 100) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'id is invalid: must be a string between 1 and 100 characters',
      }),
    };
  }

  // 3. Validate score: must be integer in [0, 999999999]
  if (
    typeof score !== 'number' ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 999999999
  ) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'score is invalid: must be an integer between 0 and 999999999',
      }),
    };
  }

  // 4. Validate timestamp: must be non-empty string
  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'timestamp is invalid: must be a non-empty string',
      }),
    };
  }

  // 5. Build the plain item — gameId is always "global"
  const item = {
    id,
    name: body.name || '',
    score,
    timestamp,
    gameId: 'global',
  };

  // 6. Write to DynamoDB using the DDB-typed format
  const putParams = {
    TableName: process.env.TABLE_NAME || 'torre-nubes-scores',
    Item: {
      id:        { S: item.id },
      name:      { S: item.name },
      score:     { N: String(item.score) },
      timestamp: { S: item.timestamp },
      gameId:    { S: 'global' },
    },
  };

  try {
    await dynamoClient.send(new PutItemCommand(putParams));
  } catch (err) {
    console.error('DynamoDB PutItem error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }

  // 7. Return 201 with the plain item (not the DDB-typed version)
  return {
    statusCode: 201,
    headers: corsHeaders,
    body: JSON.stringify(item),
  };
}

/**
 * Handles DELETE /scores.
 * Queries ALL items with gameId = "global" (paginated), then deletes them
 * in batches of 25 using BatchWriteItem.
 * Returns 204 No Content on success, 500 on DynamoDB error.
 *
 * Requirements: 4.4, 4.6
 *
 * @param {object} event - API Gateway Lambda proxy event.
 * @returns {object} Lambda proxy response.
 */
async function handleDelete(event) {
  const requestOrigin = event.headers?.Origin || event.headers?.origin;

  try {
    // Step 1: Query ALL items with gameId = "global" using pagination
    const allItems = [];
    let lastEvaluatedKey = undefined;

    do {
      const queryParams = {
        TableName: process.env.TABLE_NAME,
        IndexName: 'gameId-score-index',
        KeyConditionExpression: 'gameId = :g',
        ExpressionAttributeValues: { ':g': { S: 'global' } },
      };

      if (lastEvaluatedKey) {
        queryParams.ExclusiveStartKey = lastEvaluatedKey;
      }

      const result = await dynamoClient.send(new QueryCommand(queryParams));
      if (result.Items) {
        allItems.push(...result.Items);
      }
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    // Step 2: If no items found, return 204 immediately
    if (allItems.length === 0) {
      return {
        statusCode: 204,
        headers: buildCorsHeaders(requestOrigin),
        body: '',
      };
    }

    // Step 3: Delete all items in batches of 25 (DynamoDB BatchWriteItem limit)
    const TABLE_NAME = process.env.TABLE_NAME;
    const BATCH_SIZE = 25;

    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const batch = allItems.slice(i, i + BATCH_SIZE);
      const deleteRequests = batch.map((item) => ({
        DeleteRequest: {
          Key: { id: { S: item.id.S } },
        },
      }));

      await dynamoClient.send(
        new BatchWriteItemCommand({
          RequestItems: {
            [TABLE_NAME]: deleteRequests,
          },
        })
      );
    }

    // Step 4: Return 204 No Content
    return {
      statusCode: 204,
      headers: buildCorsHeaders(requestOrigin),
      body: '',
    };
  } catch (err) {
    console.error('handleDelete error:', err);
    return {
      statusCode: 500,
      headers: buildCorsHeaders(requestOrigin),
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

/**
 * Main Lambda handler. Routes on event.httpMethod.
 * Origin mismatch (when ALLOWED_ORIGIN is set) returns 403 before business logic.
 *
 * @param {object} event - API Gateway Lambda proxy event.
 * @returns {object} Lambda proxy response.
 */
const handler = async (event) => {
  const requestOrigin = event.headers?.Origin || event.headers?.origin;

  // Enforce origin check before executing any business logic (Requirement 5.4).
  // OPTIONS is exempt so preflight responses always get CORS headers back.
  if (
    event.httpMethod !== 'OPTIONS' &&
    ALLOWED_ORIGIN &&
    requestOrigin !== ALLOWED_ORIGIN
  ) {
    return {
      statusCode: 403,
      headers: buildCorsHeaders(requestOrigin),
      body: JSON.stringify({ error: 'Forbidden' }),
    };
  }

  switch (event.httpMethod) {
    case 'GET':
      return handleGet(event);
    case 'POST':
      return handlePost(event);
    case 'DELETE':
      return handleDelete(event);
    case 'OPTIONS':
      return handleOptions(event);
    default:
      return {
        statusCode: 405,
        headers: buildCorsHeaders(requestOrigin),
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
  }
};

// Export internals for unit testing
export { buildCorsHeaders as _buildCorsHeaders };
export { handleOptions as _handleOptions };
export { handleGet as _handleGet };
export { handlePost as _handlePost };
export { handleDelete as _handleDelete };
export { handler };
