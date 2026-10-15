export interface RetrievalMetrics {
  recall1: number;
  recall3: number;
  recall5: number;
  mrr5: number;
  ndcg5: number;
}

export interface QueryEvaluation {
  keys: readonly string[];
  metrics: RetrievalMetrics | null;
}

export function evaluateRanking(keys: readonly string[], relevantKeys: ReadonlySet<string>): QueryEvaluation {
  if (relevantKeys.size === 0) return { keys, metrics: null };
  const seen = new Set<string>();
  const relevance = keys.slice(0, 5).map((key) => {
    const hit = relevantKeys.has(key) && !seen.has(key);
    seen.add(key);
    return Number(hit);
  });
  const recall = (k: number) => relevance.slice(0, k).reduce((sum, hit) => sum + hit, 0) / relevantKeys.size;
  const firstHit = relevance.indexOf(1);
  const dcg = relevance.reduce((sum, hit, index) => sum + hit / Math.log2(index + 2), 0);
  const idealDcg = Array.from({ length: Math.min(relevantKeys.size, 5) }, (_, index) => 1 / Math.log2(index + 2))
    .reduce((sum, gain) => sum + gain, 0);
  return { keys, metrics: { recall1: recall(1), recall3: recall(3), recall5: recall(5), mrr5: firstHit < 0 ? 0 : 1 / (firstHit + 1), ndcg5: dcg / idealDcg } };
}

export function summarizeEvaluations(evaluations: readonly QueryEvaluation[]) {
  const positives = evaluations.flatMap(({ metrics }) => metrics === null ? [] : [metrics]);
  const negatives = evaluations.filter(({ metrics }) => metrics === null);
  const average = (metric: keyof RetrievalMetrics) => positives.length === 0 ? null
    : positives.reduce((sum, metrics) => sum + metrics[metric], 0) / positives.length;
  return {
    positiveQueryCount: positives.length,
    negativeQueryCount: negatives.length,
    falsePositiveQueries: negatives.filter(({ keys }) => keys.length > 0).length,
    recall1: average("recall1"),
    recall3: average("recall3"),
    recall5: average("recall5"),
    mrr5: average("mrr5"),
    ndcg5: average("ndcg5"),
  };
}
