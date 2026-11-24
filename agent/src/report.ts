import type { Report } from './agent.ts';
import { redact } from './safety.ts';

const plain = (value: string) => redact(value).replace(/[<>`@]/g, '').replace(/[\r\n]/g, ' ');
export function markdownReport(report: Report): string {
  return `## Unit Test Agent\n\nStatus: **${plain(report.status)}**\n\n${plain(report.summary)}\n\n` +
    `Decision: ${plain(report.decision ?? 'incomplete')}\n\n` +
    `Skills invoked: ${report.skills.map(plain).join(', ') || 'none'}\n\n` +
    `Proposed test files:\n${report.files.map((file) => `- ${plain(file)}`).join('\n') || '- None'}\n\n` +
    `Validation: ${report.validation.map((result) => plain(result.status)).join(', ') || 'not executed'}\n\n` +
    `API usage: ${report.usage.requests} logical requests, ${report.usage.promptTokens} input + ${report.usage.completionTokens} output = ${report.usage.totalTokens} tokens (${report.usage.cacheHitTokens} cached input). Transient retries can add provider-side usage not returned by the API.\n\n` +
    `Limitations:\n${report.limitations.map((item) => `- ${plain(item)}`).join('\n') || '- Generated tests require human review.'}\n\n` +
    'Generated proposals are downloadable workflow artifacts. Coverage and final validation are reported by the separate validation job; generation alone is not a passing result.\n';
}
