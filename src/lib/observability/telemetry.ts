import { SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("dingodocs", process.env.npm_package_version);

export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  operation: () => Promise<T>,
) {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
