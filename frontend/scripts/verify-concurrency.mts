/**
 * 并发合并 / 待确认 / 事务回滚 / 重算 / 迁移 的运行时验证（fake-indexeddb）。
 * 直接 node 运行，不进入生产依赖。
 */
import 'fake-indexeddb/auto';
import { db, initDatabase, commitChanges, resolvePendingBatch, discardPendingBatch } from '$lib/utils/db';
import { threeWayMerge } from '$lib/utils/merge';
import { migrationStamp, stamp } from '$lib/utils/syncBus';

// ---- sessionStorage / localStorage polyfill ----
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
  } else {
    console.log('✓ ' + msg);
  }
};

async function main(): Promise<void> {
  /* ---------- 1. 纯函数：三方合并 ---------- */
  {
    const base = { brand: 'A', model: 'M1', venue: '家庭' };
    const current = { brand: 'A', model: 'M2', venue: '家庭' }; // 甲改 model
    const incoming = { brand: 'A', model: 'M1', venue: '琴房' }; // 乙改 venue
    const r = threeWayMerge(base, current, incoming, ['brand', 'model', 'venue']);
    assert(r.conflicts.length === 0, '不同字段：无冲突');
    assert(r.patch.venue === '琴房' && r.patch.model === undefined, '不同字段：只合并后到一方改动，不回退对方');
  }
  {
    const base = { venue: '家庭' };
    const current = { venue: '琴房' };
    const incoming = { venue: '音乐厅' };
    const r = threeWayMerge(base, current, incoming, ['venue']);
    assert(r.conflicts.length === 1, '同一字段双方不同修改：产生 1 个冲突');
    assert(r.conflicts[0]?.currentValue === '琴房' && r.conflicts[0]?.incomingValue === '音乐厅', '冲突保留双方值');
  }
  {
    const base = { venue: '家庭' };
    const current = { venue: '琴房' };
    const incoming = { venue: '琴房' };
    const r = threeWayMerge(base, current, incoming, ['venue']);
    assert(r.conflicts.length === 0 && r.patch.venue === '琴房', '双方改成同值：直接生效');
  }

  /* ---------- 2. migrationStamp 幂等（重试不重复） ---------- */
  {
    const a = migrationStamp({ id: 'x' } as never, 1000);
    assert(a.revision === 1 && a.createdAt === 1000 && a.updatedAt === 1000, '旧数据自动补版本');
    const b = migrationStamp(a, 2000);
    assert(b.createdAt === 1000 && b.updatedAt === 1000 && b.revision === 1, '重复迁移不覆盖已补字段');
  }

  await initDatabase();
  const pianos = await db.pianos.toArray();
  assert(pianos.length === 3, '播种 3 台演示琴');

  /* ---------- 3. 模拟两个标签页先后保存同一台琴（不同字段 → 自动合并） ---------- */
  const pn = await db.pianos.get('pn-001');
  if (!pn) throw new Error('pn-001 不存在');
  const base = { ...pn };
  // 标签页甲先保存：改 brand
  await commitChanges({
    actorId: 'tab-a',
    actorName: '标签页甲',
    items: [{ table: 'pianos', op: 'update', id: pn.id, payload: { ...base, brand: 'YAMAHA-X' }, base }]
  });
  // 标签页乙基于旧版本保存：改 venue
  const afterB = await (async () => {
    const result = await commitChanges({
      actorId: 'tab-b',
      actorName: '标签页乙',
      items: [{ table: 'pianos', op: 'update', id: pn.id, payload: { ...base, venue: '音乐厅' }, base }]
    });
    return result;
  })();
  assert(afterB.pendingIds.length === 0, '不同字段并发：不产生待确认');
  const mergedRow = await db.pianos.get(pn.id);
  assert(mergedRow?.brand === 'YAMAHA-X' && mergedRow?.venue === '音乐厅', '不同字段并发：双方修改都保留（自动合并）');
  assert(mergedRow?.revision === base.revision + 2, '自动合并：修订号累计 +2');

  /* ---------- 4. 同一字段冲突 → 保留双方值进入待确认，已生效不被覆盖 ---------- */
  const base2 = { ...mergedRow } as Record<string, unknown>;
  await commitChanges({
    actorId: 'tab-a',
    actorName: '标签页甲',
    items: [{ table: 'pianos', op: 'update', id: pn.id, payload: { ...base2, brand: 'YAMAHA-A' }, base: base2 }]
  });
  const conflictRes = await commitChanges({
    actorId: 'tab-b',
    actorName: '标签页乙',
    items: [{ table: 'pianos', op: 'update', id: pn.id, payload: { ...base2, brand: 'YAMAHA-B' }, base: base2 }]
  });
  assert(conflictRes.pendingIds.length === 1, '同字段冲突：产生 1 条待确认');
  const afterConflict = await db.pianos.get(pn.id);
  assert(afterConflict?.brand === 'YAMAHA-A', '确认前：已生效值（YAMAHA-A）不被后到值覆盖');
  const pending = await db.pendingChanges.get(conflictRes.pendingIds[0]!);
  assert(pending?.kind === 'field' && pending.conflicts[0]?.field === 'brand', '待确认记录字段冲突明细');
  assert(pending.actorName === '标签页乙' && pending.currentActorName === '标签页甲', '待确认保留双方操作人');
  // 重试同样的后到提交：不重复产生待确认（同 id 覆盖）
  const retryRes = await commitChanges({
    actorId: 'tab-b',
    actorName: '标签页乙',
    items: [{ table: 'pianos', op: 'update', id: pn.id, payload: { ...base2, brand: 'YAMAHA-B' }, base: base2 }]
  });
  const pendingCount = await db.pendingChanges.where('status').equals('pending').count();
  assert(retryRes.pendingIds.length === 1 && pendingCount === 1, '重试不重复产生待确认');

  /* ---------- 5. 确认 / 放弃后立即重算（调律音分、复调、提醒） ---------- */
  {
    // 新建一台琴 + 一条 zones 与音分不一致的调律，提交后应自动重算
    const pid = 'p-test';
    await commitChanges({
      actorId: 'tab-a',
      actorName: '甲',
      items: [
        { table: 'pianos', op: 'create', payload: { id: pid, brand: 'T', model: 'X', serialNo: '', type: '立式', venue: '家庭', purchaseYear: 2020, state: '正常' } },
        {
          table: 'tunings',
          op: 'create',
          payload: {
            id: 't-test', pianoId: pid, date: '2025-01-10', basePitchHz: 440,
            avgDeviationCents: 0, maxDeviationCents: 0,
            zones: { bass: 15, mid: 15, treble: 15 }, technician: '', pitchRaised: false
          }
        },
        { table: 'reminders', op: 'create', payload: { id: 'r-test', pianoId: pid, cycleMonths: 6, lastTuningDate: '2024-01-01', nextDueDate: '2024-07-01', state: '超期' } }
      ]
    });
    const t = await db.tunings.get('t-test');
    assert(t?.avgDeviationCents === 15 && t?.maxDeviationCents === 15, '提交后立即重算最近调律音分');
    assert(t?.pitchRaised === true, '超阈值自动复调标记');
    assert(t.source === '' && (await db.pendingChanges.get('pd-tunings-t-test'))?.kind === 'source', '缺来源自动标待确认');
    const r = await db.reminders.get('r-test');
    assert(r?.lastTuningDate === '2025-01-10' && r.nextDueDate === '2025-07-10', '提交后提醒按最近调律重算');
  }

  /* ---------- 6. 一批中任何失败整批回滚 ---------- */
  {
    const beforePianos = await db.pianos.toArray();
    let threw = false;
    try {
      await commitChanges({
        actorId: 'tab-a',
        actorName: '甲',
        items: [
          { table: 'pianos', op: 'create', payload: { id: 'p-ok', brand: 'OK', model: 'OK', serialNo: '', type: '立式', venue: '家庭', purchaseYear: 2020, state: '正常' } },
          { table: 'tunings', op: 'update', id: 'not-exist', payload: { id: 'not-exist' } }
        ]
      });
    } catch {
      threw = true;
    }
    assert(threw, '批内失败：抛出错误');
    const leaked = await db.pianos.get('p-ok');
    assert(leaked === undefined, '整批回滚：先写入的 p-ok 未残留');
    const afterPianos = await db.pianos.toArray();
    assert(afterPianos.length === beforePianos.length, '整批回滚：行数不变');
  }

  /* ---------- 7. 确认待确认（采用后到值）与放弃 ---------- */
  {
    const pid = conflictRes.pendingIds[0]!;
    await resolvePendingBatch(
      [{ pendingId: pid, choices: { brand: 'incoming' }, resolvedBy: '裁决人' }],
      '裁决人'
    );
    const resolved = await db.pianos.get(pn.id);
    assert(resolved?.brand === 'YAMAHA-B', '确认采用后到值：写回生效');
    const pd = await db.pendingChanges.get(pid);
    assert(pd?.status === 'confirmed' && pd.resolvedBy === '裁决人', '待确认标记已确认并留痕');

    // 缺来源：未补来源确认必须失败（且事务不改变状态）
    const srcPid = 'pd-tunings-t-test';
    let threw = false;
    try {
      await resolvePendingBatch([{ pendingId: srcPid, resolvedBy: '裁决人' }], '裁决人');
    } catch {
      threw = true;
    }
    assert(threw, '缺来源未补填：确认失败');
    const stillPending = await db.pendingChanges.get(srcPid);
    assert(stillPending?.status === 'pending', '缺来源确认失败：状态仍为待确认（事务回滚）');
    await resolvePendingBatch([{ pendingId: srcPid, source: '陆师傅 · 补录', resolvedBy: '裁决人' }], '裁决人');
    const t = await db.tunings.get('t-test');
    assert(t?.source === '陆师傅 · 补录', '补来源确认后写回来源');

    // 放弃
    await db.pendingChanges.put({
      id: 'pd-discard', table: 'pianos', recordId: pn.id, pianoId: pn.id, kind: 'field', op: 'update',
      reason: 'conflict', conflicts: [], incoming: {}, baseRevision: 1, status: 'pending',
      actorId: 'tab-b', actorName: '乙', source: '', createdAt: Date.now()
    });
    await discardPendingBatch(['pd-discard'], '裁决人');
    assert((await db.pendingChanges.get('pd-discard'))?.status === 'discarded', '放弃待确认：标记已放弃');
  }

  /* ---------- 8. stamp 基础行为 ---------- */
  {
    const s = stamp({ id: 'a' }, 5);
    assert(s.revision === 1 && s.createdAt === 5 && s.updatedAt === 5, 'stamp 补修订号与时间戳');
  }

  console.log(process.exitCode ? '\n存在失败用例' : '\n全部用例通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
