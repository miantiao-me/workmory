export interface RetrievalDocument {
  key: string;
  content: string;
  tags: string[];
}

export interface RetrievalCase {
  id: string;
  group: "lexical" | "paraphrase" | "hard" | "negative";
  query: string;
  intent: string;
  relevantKeys: string[];
  distractorKeys?: string[];
}

export const evaluationNow = Date.parse("2026-08-01T12:00:00Z");

// Fictional project notes and task-based judgments, maintained independently of search output.
export const retrievalDocuments: RetrievalDocument[] = [
  { key: "atlas/retry-policy", tags: ["resilience"], content: "Atlas webhook retry policy: use exponential backoff after a transient delivery failure." },
  { key: "atlas/retry-jitter", tags: ["resilience"], content: "Atlas webhook retry policy: add random jitter so failed deliveries do not retry together." },
  { key: "atlas/cache-ttl", tags: ["cache-design"], content: "Atlas catalog cache invalidation uses a short TTL to bound outdated product descriptions." },
  { key: "atlas/cache-events", tags: ["cache-design"], content: "Atlas catalog cache invalidation also evicts product entries after a catalog update event." },
  { key: "atlas/cache-metrics", tags: ["observability"], content: "Atlas cache dashboards chart hit ratios and request duration; they do not document eviction rules." },
  { key: "beacon/sql-rollout", tags: ["database-rollout"], content: "Beacon schema migration adds a nullable column before deploying readers, then backfills existing rows." },
  { key: "beacon/rollback", tags: ["release-safety"], content: "Beacon deployment rollback switches the release pointer back to the previous application artifact." },
  { key: "beacon/restore-drill", tags: ["backup-drill"], content: "Beacon backup restoration rehearses loading an archived database into an isolated sandbox." },
  { key: "cedar/contrast", tags: ["界面偏好"], content: "雪松项目采用深色模式，并提高文字与背景的对比度。" },
  { key: "cedar/offline", tags: ["mobile-client"], content: "雪松移动端支持离线编辑，恢复网络后按版本号同步草稿。" },
  { key: "cedar/queue", tags: ["job-scheduling"], content: "雪松项目的队列按租户分组，每组限制同时执行的任务数。" },
  { key: "delta/quoted-config", tags: ["parser-notes"], content: 'Delta parser preserves the literal setting mode "strict" when exporting configuration.' },
  { key: "delta/archive", tags: ["storage-notes"], content: `${"Delta archived meeting notes describe routine planning and review. ".repeat(30)}The glacier checksum manifest detects corrupted archive chunks before restoration.` },
  { key: "delta/upload-limit", tags: ["upload-safety"], content: "Delta rejects oversized uploads before allocating a multipart buffer." },
  { key: "ember/key-rotation", tags: ["credential-lifecycle"], content: "Ember credential rollover keeps the old signing secret valid during a brief overlap window." },
  { key: "ember/access-denied", tags: ["authorization"], content: "Ember rejects requests whose authenticated account lacks access to the requested workspace." },
  { key: "fjord/app-revert", tags: ["incident-response"], content: "Fjord project experience notes, current procedure dated 2026-06-12: after a faulty application deployment, route traffic to the last healthy container image. Preserve database writes; do not restore a database snapshot for this application-only incident." },
  { key: "fjord/db-recovery", tags: ["incident-response"], content: "Fjord project experience notes: database rollback and restore recovers accidentally deleted customer rows using a verified snapshot plus transaction logs. This repairs data loss, not a bad application release." },
  { key: "fjord/old-release", tags: ["incident-response"], content: "Fjord project experience notes, obsolete release rollback runbook dated 2025-02-10: restore the entire database snapshot after every faulty deployment. Historical guidance only; the current 2026-06-12 procedure switches container images and preserves writes." },
  { key: "grove/cache-current", tags: ["catalog-operations"], content: "Grove project experience notes, current catalog freshness policy dated 2026-04-18: invalidate the affected cached product immediately when a price-change event arrives. Scheduled expiry alone is not sufficient for price updates." },
  { key: "grove/cache-dashboard", tags: ["catalog-operations"], content: "Grove project experience notes: cache invalidation metrics dashboard displays eviction counts, cache hit ratios and latency. Viewing these metrics does not invalidate stale prices or describe how entries are removed." },
  { key: "grove/cache-old", tags: ["catalog-operations"], content: "Grove project experience notes, obsolete policy dated 2025-01-08: catalog cache invalidation waits for a nightly expiry sweep. Retained for historical comparison; current policy dated 2026-04-18 uses immediate price-change event eviction." },
  { key: "harbor/rotation", tags: ["secret-operations"], content: "Harbor project experience notes: routine signing key rotation publishes a new secret and accepts both old and new signatures for thirty minutes to avoid disconnecting clients. Use this overlap only when the old key is not compromised." },
  { key: "harbor/revocation", tags: ["secret-operations"], content: "Harbor project experience notes: when a signing key is stolen, revoke the compromised key immediately and reject its signatures. Do not keep an overlap window for a leaked secret, even if some clients must sign in again." },
  { key: "iris/sync-current", tags: ["草稿同步"], content: "Iris 项目经验笔记：2026年5月20日起的当前方案，离线草稿重连发生版本冲突时保留双方副本，由用户合并，不能静默覆盖他人的修改。" },
  { key: "iris/sync-old", tags: ["草稿同步"], content: "Iris 项目经验笔记：2025年3月1日的旧版离线草稿同步方案，重连冲突时最后写入覆盖全部内容。此方案已经废弃 obsolete，仅留作历史记录；当前方案保留双方副本供用户合并。" },
];

export const retrievalCases: RetrievalCase[] = [
  { id: "exact-key", group: "lexical", query: "beacon/sql-rollout", intent: "Find the Beacon schema rollout note by its stable key.", relevantKeys: ["beacon/sql-rollout"] },
  { id: "english-tag", group: "lexical", query: "upload-safety", intent: "Find the note assigned the upload safety tag.", relevantKeys: ["delta/upload-limit"] },
  { id: "chinese-tag", group: "lexical", query: "界面偏好", intent: "查找雪松界面偏好说明。", relevantKeys: ["cedar/contrast"] },
  { id: "english-phrase", group: "lexical", query: "nullable column", intent: "Find the schema migration strategy using an initially nullable column.", relevantKeys: ["beacon/sql-rollout"] },
  { id: "chinese-phrase", group: "lexical", query: "深色模式", intent: "查找雪松深色显示方案。", relevantKeys: ["cedar/contrast"] },
  { id: "short-chinese-two", group: "lexical", query: "离线", intent: "查找无网络时的移动编辑方案。", relevantKeys: ["cedar/offline"] },
  { id: "short-chinese-one", group: "lexical", query: "队", intent: "查找雪松任务排队方案。", relevantKeys: ["cedar/queue"] },
  { id: "quoted-phrase", group: "lexical", query: 'mode "strict"', intent: "Find the literal strict-mode export setting, including quotes.", relevantKeys: ["delta/quoted-config"] },
  { id: "distant-body", group: "lexical", query: "glacier checksum manifest", intent: "Find archive corruption detection described beyond the opening notes.", relevantKeys: ["delta/archive"] },
  { id: "multiple-retries", group: "lexical", query: "webhook retry policy", intent: "Find both retry delay and desynchronization guidance for Atlas webhook delivery.", relevantKeys: ["atlas/retry-policy", "atlas/retry-jitter"] },
  { id: "multiple-cache", group: "lexical", query: "catalog cache invalidation", intent: "Find both time-based and event-based catalog eviction strategies; hit-ratio dashboards do not answer this task.", relevantKeys: ["atlas/cache-ttl", "atlas/cache-events"] },
  { id: "rollback-versus-restore", group: "lexical", query: "release pointer", intent: "Find application release reversal rather than database backup restoration.", relevantKeys: ["beacon/rollback"] },
  { id: "credential-phrase", group: "lexical", query: "overlap window", intent: "Find the period that allows both old and new signing secrets.", relevantKeys: ["ember/key-rotation"] },
  { id: "authorization-phrase", group: "lexical", query: "authenticated account", intent: "Find the rule preventing unauthorized workspace access.", relevantKeys: ["ember/access-denied"] },
  { id: "paraphrase-retries-en", group: "paraphrase", query: "How should unsuccessful callback attempts be spaced apart?", intent: "Find both increasing retry delays and jitter for failed webhook delivery.", relevantKeys: ["atlas/retry-policy", "atlas/retry-jitter"] },
  { id: "paraphrase-offline-zh", group: "paraphrase", query: "断网期间怎样修改内容并在重连时合并？", intent: "查找雪松移动端无网络编辑与重连同步策略。", relevantKeys: ["cedar/offline"] },
  { id: "paraphrase-rotation-zh", group: "paraphrase", query: "更换凭证时如何避免正在使用旧密钥的客户端立即失效？", intent: "查找签名凭证轮换时的双凭证过渡方案。", relevantKeys: ["ember/key-rotation"] },
  { id: "paraphrase-cache-en", group: "paraphrase", query: "How can shoppers stop seeing obsolete merchandise details?", intent: "Find both strategies that remove stale catalog entries.", relevantKeys: ["atlas/cache-ttl", "atlas/cache-events"] },
  { id: "hard-app-rollback", group: "hard", query: "Fjord rollback after a broken deployment without losing newly written customer data", intent: "Use the current application-only recovery procedure while preserving database writes.", relevantKeys: ["fjord/app-revert"], distractorKeys: ["fjord/db-recovery", "fjord/old-release"] },
  { id: "hard-db-restore", group: "hard", query: "Fjord recover customer rows accidentally deleted from the database, not an application release", intent: "Recover lost database data using snapshot and transaction logs.", relevantKeys: ["fjord/db-recovery"], distractorKeys: ["fjord/app-revert", "fjord/old-release"] },
  { id: "hard-cache-action", group: "hard", query: "Grove cache invalidation: how do we stop serving an old price right after a product price changes?", intent: "Find the current event-driven eviction action rather than a monitoring dashboard or obsolete nightly sweep.", relevantKeys: ["grove/cache-current"], distractorKeys: ["grove/cache-dashboard", "grove/cache-old"] },
  { id: "hard-cache-current-zh", group: "hard", query: "Grove 现在商品价格更新后怎样立即清掉缓存，不要旧的夜间过期方案？", intent: "查找当前即时价格事件驱动清理方案。", relevantKeys: ["grove/cache-current"], distractorKeys: ["grove/cache-old", "grove/cache-dashboard"] },
  { id: "hard-compromised-key", group: "hard", query: "Harbor signing key leaked: should old signatures remain accepted during rotation?", intent: "A compromised signing key requires immediate revocation rather than routine overlap.", relevantKeys: ["harbor/revocation"], distractorKeys: ["harbor/rotation"] },
  { id: "hard-routine-key-zh", group: "hard", query: "Harbor 密钥没有泄露，正常更换时怎样让持有旧凭证的客户端继续使用？", intent: "无泄露的常规轮换需要双密钥过渡，不应立即吊销。", relevantKeys: ["harbor/rotation"], distractorKeys: ["harbor/revocation"] },
  { id: "hard-sync-current", group: "hard", query: "Iris 当前离线草稿重连冲突如何处理，不能覆盖别人的修改？", intent: "选择保留双方副本供合并的当前方案，排除旧版最后写入覆盖。", relevantKeys: ["iris/sync-current"], distractorKeys: ["iris/sync-old"] },
  { id: "hard-sync-cross-language", group: "hard", query: "What is the current Iris approach to reconciling disconnected edits without silently discarding another person's changes?", intent: "Find the Chinese current conflict-resolution note preserving both drafts.", relevantKeys: ["iris/sync-current"], distractorKeys: ["iris/sync-old"] },
  { id: "negative-en", group: "negative", query: "satellite orbital inclination", intent: "No project note discusses spacecraft trajectories.", relevantKeys: [] },
  { id: "negative-zh", group: "negative", query: "水稻病虫害防治", intent: "语料没有农业病虫害知识。", relevantKeys: [] },
];
