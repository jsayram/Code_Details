/**
 * LLM API Route
 * Multi-provider LLM endpoint with caching and rate limiting
 * 
 * Supports: OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, xAI, Azure, Ollama
 *
 * D08 gate (Jose, 2026-10-30): admins only (users.role from the session), and
 * every call takes one unit of a per-user and a global daily cap kept in
 * Convex (convex/llmUsage.ts), so a restart doesn't reset them. Each call is
 * logged there without the prompt or the answer. Anything that can't be
 * checked (no login, no Convex) is refused before a provider is called.
 */

import { NextRequest, NextResponse } from 'next/server';
import { makeFunctionReference } from 'convex/server';
import { betterAuthRole, routeDocOwner, viewerMutation } from '@/lib/auth-server';
import { callLLM, PROVIDER_IDS } from '@/llm';
import { LLMError, parseLLMError } from '@/llm/errors';

type Reservation =
  | { ok: true; callId: string; remainingToday: number }
  | { ok: false; code: 'forbidden' | 'user_cap' | 'global_cap' };
const reserve = makeFunctionReference<'mutation', { provider: string; model?: string }, Reservation>('llmUsage:reserve');
const finish = makeFunctionReference<'mutation', { callId: string; ok: boolean; latencyMs: number; errorStatus?: number }, boolean>('llmUsage:finish');

const problem = (status: number, slug: string, title: string, detail: string) =>
  NextResponse.json(
    { success: false, error: { type: `https://api.codedetails.dev/problems/${slug}`, title, status, detail } },
    { status, headers: { 'Content-Type': 'application/problem+json' } }
  );

// Rate limiting: Track last request time per user
const lastRequestTimes = new Map<string, number>();
const RATE_LIMIT_MS = 2000; // 2 seconds between requests

export async function POST(request: NextRequest) {
  // 1. Admins only: users.role from the session (null when signed out or
  // with no login at all).
  const role = await betterAuthRole();
  if (!role) return problem(401, 'unauthorized', 'Unauthorized', 'Authentication required');
  if (role !== 'admin') return problem(403, 'forbidden', 'Forbidden', 'The model API is limited to administrators');
  // The in-memory throttle below keys on the session's own account; the caps
  // that matter are the persistent ones in step 4.
  const userId = (await routeDocOwner())?.writeKey ?? null;
  if (!userId) return problem(401, 'unauthorized', 'Unauthorized', 'Authentication required');

  // 2. Rate limiting per user
  const lastRequest = lastRequestTimes.get(userId) || 0;
  const now = Date.now();
  
  if (now - lastRequest < RATE_LIMIT_MS) {
    const waitTime = Math.ceil((RATE_LIMIT_MS - (now - lastRequest)) / 1000);
    return NextResponse.json(
      {
        success: false,
        error: {
          type: 'https://api.codedetails.dev/problems/rate-limited',
          title: 'Rate Limited',
          status: 429,
          detail: `Please wait ${waitTime}s before making another request`,
        }
      },
      { status: 429, headers: { 'Content-Type': 'application/problem+json' } }
    );
  }
  
  lastRequestTimes.set(userId, now);

  // Clean up old entries periodically
  if (lastRequestTimes.size > 1000) {
    const cutoff = now - RATE_LIMIT_MS * 10;
    for (const [id, time] of lastRequestTimes.entries()) {
      if (time < cutoff) {
        lastRequestTimes.delete(id);
      }
    }
  }

  try {
    // 3. Parse request body
    const body = await request.json();
    const { 
      prompt, 
      provider = PROVIDER_IDS.OPENAI, 
      model, 
      temperature,
      maxTokens,
      customApiKey,
      customBaseUrl,
    } = body;

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: {
            type: 'https://api.codedetails.dev/problems/validation-error',
            title: 'Validation Error',
            status: 400,
            detail: 'Prompt is required and must be a string',
          }
        },
        { status: 400, headers: { 'Content-Type': 'application/problem+json' } }
      );
    }

    // 4. Take one unit of today's per-user and global caps (Convex, durable).
    // Refused or unavailable: no provider call.
    let reservation: Reservation | null = null;
    try {
      reservation = (await viewerMutation(reserve, { provider: String(provider), ...(typeof model === 'string' ? { model } : {}) }))?.result ?? null;
    } catch {
      reservation = null;
    }
    if (!reservation) return problem(503, 'usage-unavailable', 'Usage Check Unavailable', 'The usage limit could not be checked; try again later');
    if (!reservation.ok) {
      if (reservation.code === 'forbidden') return problem(403, 'forbidden', 'Forbidden', 'The model API is limited to administrators');
      return problem(429, 'daily-cap', 'Daily Limit Reached', reservation.code === 'user_cap' ? 'Your daily model-call limit is used up' : 'Today\'s model-call limit is used up');
    }
    const callId = reservation.callId;
    const done = (ok: boolean, latencyMs: number, errorStatus?: number) =>
      viewerMutation(finish, { callId, ok, latencyMs, ...(errorStatus === undefined ? {} : { errorStatus }) }).catch(() => null);

    // 5. Call LLM
    const startTime = Date.now();
    
    let result: Awaited<ReturnType<typeof callLLM>>;
    try {
      result = await callLLM({
        prompt,
        provider,
        model,
        temperature,
        maxTokens,
        customApiKey,
        customBaseUrl,
      });
    } catch (error) {
      await done(false, Date.now() - startTime, error instanceof LLMError ? error.status : undefined);
      throw error;
    }
    
    const latencyMs = Date.now() - startTime;
    await done(true, latencyMs);

    // 6. Return result
    return NextResponse.json({
      success: true,
      result,
      metadata: {
        provider,
        model,
        latencyMs,
        cached: false, // Cache handled externally if needed
      }
    });

  } catch (error: unknown) {
    console.error('[LLM API] Error:', error);
    
    // Convert to LLMError if not already
    const llmError = error instanceof LLMError 
      ? error 
      : parseLLMError(error, 'unknown');
    
    const problemDetail = llmError.toProblemDetail(request.url);
    
    return NextResponse.json(
      { success: false, error: problemDetail },
      { status: llmError.status, headers: { 'Content-Type': 'application/problem+json' } }
    );
  }
}
