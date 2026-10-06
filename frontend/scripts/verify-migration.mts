/**
 * v1 → v2 真实结构升级验证：
 * 先以仅含 v1 结构的临时 Dexie 写入旧格式行（无 revision/时间戳/source），
 * 删除实例后再由应用 db 打开触发 upgrade + migrateLegacyRows，
 * 验证自动补版本、缺来源标待确认、重试迁移不重复。
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const sessionStore = new Map<string, string>();
(globalThis as Record<string, unknown>).sessionStorage = {
  getItem: (k: string) => sessionStore.get(k) ?? null,
  setItem: (k: string, v: string) => void sessionStore.set(k, v),
  removeItem: (k: string) => void sessionStore.delete(k)
};
const localStore = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => localStore.get(k) ?? null,
  setItem: (k: string, v: string) => void localStore.set(k, v),
  removeItem: (k: string) => void localStore.delete(k)
};

const assert = (cond: boolean, msg: string): void => {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exitCode = 1;
  } else console.log('✓ ' + msg);
};

async function main(): Promise<void> {
  // 先写旧库，再动态引入应用 db（避免模块加载时提前建库）
  // 1) 用旧结构（v1）建库并写入旧格式数据
  const { DB_NAME } = await import('$lib/utils/db');
  const legacy = new Dexie(DB_NAME);
  legacy.version(1).stores({
    pianos: 'id, brand, updatedAt',
    tunings: 'id, pianoId, date, updatedAt',
    voicings: 'id, pianoId, date, updatedAt',
    environments: 'id, pianoId, date, updatedAt',
    reminders: 'id, pianoId, updatedAt'
  });
  await legacy.open();
  await legacy.table('pianos').put({ id: 'old-1', brand: 'KAWAI', model: 'K3', type: '立式', venue: '家庭', purchaseYear: 2010, state: '正常' });
  await legacy.table('tunings').put({
    id: 'old-t1', pianoId: 'old-1', date: '2023-01-01', basePitchHz: 440,
    avgDeviationCents: 5, maxDeviationCents: 9, zones: { bass: 9, mid: 5, treble: 1 },
    technician: '老周', pitchRaised: false
  });
  await legacy.table('voicings').put({
    id: 'old-v1', pianoId: 'old-1', type: '整音', parts: '毡槌', material: '',
    date: '2023-02-01', operator: '老周', state: '已完成'
  });
  await legacy.close();

  // 2) 应用 db 打开：触发 v2 upgrade 与 migrateLegacyRows
  const { db, initDatabase } = await import('$lib/utils/db');
  await initDatabase();
  assert(db.verno === 2, `结构升级到 v2（实际 ${db.verno}）`);

  const piano = await db.pianos.get('old-1');
  assert(typeof piano?.revision === 'number' && typeof piano?.createdAt === 'number', '旧琴档自动补修订号与时间戳');

  const tuning = await db.tunings.get('old-t1');
  assert(typeof tuning?.revision === 'number', '旧调律记录自动补修订号');
  assert(tuning?.source === '', '旧调律来源补为空串');
  const pdTuning = await db.pendingChanges.get('pd-tunings-old-t1');
  assert(pdTuning?.kind === 'source' && pdTuning?.status === 'pending', '旧调律缺来源 → 待确认');
  assert(pdTuning?.actorName === '旧数据迁移', '待确认来源标记为旧数据迁移');

  const pdVoicing = await db.pendingChanges.get('pd-voicings-old-v1');
  assert(pdVoicing?.kind === 'source', '旧维修缺来源 → 待确认');

  // 3) 再次执行迁移（模拟重试）：待确认不重复
  await initDatabase();
  const count = await db.pendingChanges.where('kind').equals('source').count();
  assert(count === 2, `重试迁移不重复（缺来源待确认仍为 2 条，实际 ${count}）`);

  // 4) 旧数据的音分在迁移后首次提交 / 重算时对齐
  assert(tuning?.avgDeviationCents === 5, '旧调律音分保留');

  console.log(process.exitCode ? '\n存在失败用例' : '\n迁移用例全部通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
