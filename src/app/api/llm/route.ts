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
 * checked (no login, no Convex) is refused before a provider is called. The
 * checks are shared with the other provider routes (src/backend/llm/gate.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { baseUrlProblem, requireLlmAdmin, reserveLlmCall, type GateRefusal } from '@/backend/llm/gate';
import { callLLM, PROVIDER_IDS } from 'repo-docs/llm/server';
import { LLMError } from 'repo-docs/llm';
import { createLLMErrorResponse, toLLMError } from '@/backend/llm/errors';

const problem = (status: number, slug: string, title: string, detail: string) =>
  NextResponse.json(
    { success: false, error: { type: `https://api.codedetails.dev/problems/${slug}`, title, status, detail } },
    { status, headers: { 'Content-Type': 'application/problem+json' } }
  );
const refused = (r: GateRefusal) => problem(r.status, r.slug, r.title, r.detail);

// Rate limiting: Track last request time per user
const lastRequestTimes = new Map<string, number>();
const RATE_LIMIT_MS = 2000; // 2 seconds between requests

export async function POST(request: NextRequest) {
  // 1. Admins only: users.role from the session (null when signed out or
  // with no login at all). The in-memory throttle below keys on the session's
  // own account; the caps that matter are the persistent ones in step 4.
  const admin = await requireLlmAdmin();
  if (!admin.ok) return refused(admin);
  const userId = admin.accountId;

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

    // A custom base URL only to a local model server (no SSRF with our keys).
    const badBaseUrl = baseUrlProblem(customBaseUrl);
    if (badBaseUrl) return refused(badBaseUrl);

    // 4. Take one unit of today's per-user and global caps (Convex, durable).
    // Refused or unavailable: no provider call.
    const ticket = await reserveLlmCall(provider, model);
    if (!ticket.ok) return refused(ticket);
    const done = ticket.finish;

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
    
    // Convert to LLMError if not already, then to the app's problem response
    return createLLMErrorResponse(toLLMError(error), request);
  }
}
