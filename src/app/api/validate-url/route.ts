/**
 * Server-side URL validation endpoint
 * Bypasses CORS restrictions by checking URLs from the server
 */

import { NextRequest } from 'next/server';
import { urlValidationRequestSchema } from '@/types/schemas';
import { serverError, validationError, success } from '@/lib/api-errors';
import { safeFetch, UnsafeUrlError } from '@/backend/net/safe-fetch';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input with Zod schema
    const validationResult = urlValidationRequestSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0];
      return validationError(
        [{
          field: firstError.path.join('.'),
          message: firstError.message,
        }],
        "Invalid URL validation request"
      );
    }

    const { url } = validationResult.data;

    const startTime = Date.now();
    const timeoutMs = 5000;

    try {
      // H1: the URL is the visitor's, so it goes through the SSRF guard
      // (public addresses only, every redirect checked, one deadline). Only
      // the status matters, so the body is never read.
      const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; URLChecker/1.0)' };
      const opts = { timeoutMs, discardBody: true };
      let response: Response;
      try {
        response = await safeFetch(url, { method: 'HEAD', headers }, opts);
      } catch (headError) {
        if (headError instanceof UnsafeUrlError) throw headError;
        // If HEAD fails, try GET
        response = await safeFetch(url, { method: 'GET', headers }, opts);
      }

      const responseTime = Date.now() - startTime;

      // Consider successful responses and redirects as reachable
      // Also accept 405 (Method Not Allowed) since server responded
      const isReachable =
        response.ok ||
        (response.status >= 300 && response.status < 400) ||
        response.status === 405;

      return success({
        reachable: isReachable,
        statusCode: response.status,
        responseTime,
      });
    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof UnsafeUrlError) {
        return success({ reachable: false, error: error.message, responseTime });
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message === 'Request timed out') {
          return success({
            reachable: false,
            error: `Request timed out after ${timeoutMs}ms`,
            responseTime,
          });
        }

        return success({
          reachable: false,
          error: error.message,
          responseTime,
        });
      }

      return success({
        reachable: false,
        error: 'Unknown error occurred',
        responseTime,
      });
    }
  } catch (error) {
    return serverError(error, "URL validation service failed");
  }
}
