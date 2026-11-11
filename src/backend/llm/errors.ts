// X1: the app side of the LLM engine's errors. The engine (src/llm) throws its
// own LLMError and knows nothing about Next.js or the app's error codes; the
// routes turn those errors into responses here. Server-side only.
import { NextResponse } from 'next/server';
import type { ErrorCode } from '@/constants/error-codes';
import { LLMError, parseLLMError, type LLMErrorCode, type LLMProblemDetail } from '@/llm/errors';

/** A problem body the app may send: an engine LLM code or one of the app's own codes. */
export type AppLLMProblemDetail = Omit<LLMProblemDetail, 'code'> & { code: LLMErrorCode | ErrorCode };

/** Any thrown value as an engine LLMError (provider unknown when it wasn't one already). */
export function toLLMError(error: unknown, provider = 'unknown', model?: string): LLMError {
  return error instanceof LLMError ? error : parseLLMError(error, provider, model);
}

/**
 * Create a NextResponse from an LLMError (RFC 7807 format)
 */
export function createLLMErrorResponse(
  error: LLMError,
  request?: Request
): NextResponse<{ success: false; error: AppLLMProblemDetail }> {
  const problemDetail: AppLLMProblemDetail = error.toProblemDetail(request?.url);

  return NextResponse.json(
    { success: false, error: problemDetail },
    {
      status: error.status,
      headers: {
        'Content-Type': 'application/problem+json',
      },
    }
  );
}
