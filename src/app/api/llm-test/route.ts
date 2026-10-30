/**
 * LLM Test API
 * Tests connection to an LLM provider
 *
 * D08 gate: a connection test is a real provider call on the server's keys,
 * so it gets the /api/llm rules (src/backend/llm/gate.ts): admins only, one
 * unit of the daily caps per test, logged without any prompt or key, and a
 * custom base URL only to a local model server. Nothing about keys (not even
 * whether one is set, or its length) is logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { baseUrlProblem, requireLlmAdmin, reserveLlmCall } from '@/backend/llm/gate';
import { testProviderConnection } from '@/llm';

// Rate limiting: Track last test time per user
const lastTestTimes = new Map<string, number>();
const RATE_LIMIT_MS = 5000; // 5 seconds between tests

export async function POST(request: NextRequest) {
  // 1. Admins only (users.role from the session).
  const admin = await requireLlmAdmin();
  if (!admin.ok) return NextResponse.json({ success: false, message: admin.detail }, { status: admin.status });
  const userId = admin.accountId;

  // 2. Rate limiting
  const lastTest = lastTestTimes.get(userId) || 0;
  const now = Date.now();
  
  if (now - lastTest < RATE_LIMIT_MS) {
    const waitTime = Math.ceil((RATE_LIMIT_MS - (now - lastTest)) / 1000);
    return NextResponse.json(
      { success: false, message: `Please wait ${waitTime}s before testing again` },
      { status: 429 }
    );
  }
  
  lastTestTimes.set(userId, now);

  // Clean up old entries
  if (lastTestTimes.size > 1000) {
    const cutoff = now - RATE_LIMIT_MS * 2;
    for (const [id, time] of lastTestTimes.entries()) {
      if (time < cutoff) {
        lastTestTimes.delete(id);
      }
    }
  }

  try {
    const body = await request.json();
    const { provider, model, apiKey, baseUrl } = body;
    
    console.log('[LLM Test] provider:', provider, 'model:', model);

    if (!provider || !model) {
      return NextResponse.json(
        { success: false, message: 'Provider and model are required' },
        { status: 400 }
      );
    }
    const badBaseUrl = baseUrlProblem(baseUrl);
    if (badBaseUrl) return NextResponse.json({ success: false, message: badBaseUrl.detail }, { status: 400 });

    // One unit of today's caps per test; refused or unchecked: no provider call.
    const ticket = await reserveLlmCall(provider, model);
    if (!ticket.ok) return NextResponse.json({ success: false, message: ticket.detail }, { status: ticket.status });

    const startTime = Date.now();
    let result: Awaited<ReturnType<typeof testProviderConnection>>;
    try {
      result = await testProviderConnection({
        providerId: provider,
        modelId: model,
        apiKey,
        baseUrl,
      });
    } catch (error) {
      await ticket.finish(false, Date.now() - startTime);
      throw error;
    }
    await ticket.finish(!!(result as { success?: boolean })?.success, Date.now() - startTime);

    console.log('[LLM Test] result:', (result as { success?: boolean })?.success ? 'ok' : 'failed');
    return NextResponse.json(result);
    
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json(
      { success: false, message: err.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
