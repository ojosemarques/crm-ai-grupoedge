import { runLocalAIEvaluation } from "@/modules/ai/evals/local-evaluation-runner";

const report = await runLocalAIEvaluation();
for (const result of report.results) {
  console.log(`${result.passed ? "PASS" : "FAIL"} ${result.category} ${result.key} ${result.expectedReasonCode}`);
}
if (!report.passed) process.exitCode = 1;
