/**
 * 首次打开应用时灌入的演示数据
 * 只在 pianos 表为空时执行。钢琴 → 调律记录 → 维修 / 环境 → 周期提醒 互相引用，
 * 其中包含 1 台超期琴与 2 条异常环境记录，保证 5 个页面第一次进入都有内容可看。
 */
import type { PianoRow, TuningRow, VoicingRow, EnvironmentRow, ReminderRow } from './db';
import { db, ROW_REVISION } from './db';

function rev<T>(row: T): T & { revision: number; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

const PIANOS: Array<Omit<PianoRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'pn-001', brand: 'YAMAHA', model: 'U1', serialNo: 'U1-6132457', type: '立式', venue: '琴房', purchaseYear: 2015, state: '正常' },
  { id: 'pn-002', brand: 'STEINWAY', model: 'B-211', serialNo: 'B-598812', type: '三角', venue: '音乐厅', purchaseYear: 2008, state: '正常' },
  { id: 'pn-003', brand: '珠江', model: 'UP118', serialNo: 'ZJ-1180621', type: '立式', venue: '家庭', purchaseYear: 2012, state: '待修' }
];

const TUNINGS: Array<Omit<TuningRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  {
    id: 'tn-001',
    pianoId: 'pn-001',
    date: '2024-04-08',
    basePitchHz: 440,
    avgDeviationCents: -6.5,
    maxDeviationCents: -14.2,
    zones: { bass: -14.2, mid: -5.1, treble: -2.8 },
    technician: '陆师傅',
    pitchRaised: false
  },
  {
    id: 'tn-002',
    pianoId: 'pn-002',
    date: '2024-03-20',
    basePitchHz: 441.5,
    avgDeviationCents: 9.8,
    maxDeviationCents: 21.4,
    zones: { bass: 6.2, mid: 9.8, treble: 21.4 },
    technician: '顾老师',
    pitchRaised: true
  },
  {
    id: 'tn-003',
    pianoId: 'pn-003',
    date: '2023-11-02',
    basePitchHz: 437.2,
    avgDeviationCents: -22.5,
    maxDeviationCents: -35,
    zones: { bass: -35, mid: -21.4, treble: -12.6 },
    technician: '陆师傅',
    pitchRaised: true
  }
];

const VOICINGS: Array<Omit<VoicingRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'vo-001', pianoId: 'pn-002', type: '整音', parts: '毡槌', material: '进口羊毛毡 · 中硬度', date: '2024-03-21', operator: '顾老师', state: '已完成' },
  { id: 'vo-002', pianoId: 'pn-003', type: '换弦', parts: '琴弦', material: '德国 Roslau 0.9mm', date: '2024-04-15', operator: '陆师傅', state: '计划' },
  { id: 'vo-003', pianoId: 'pn-001', type: '击弦机调整', parts: '联动杆', material: '原厂联动杆 · 间隙 0.2mm', date: '2024-04-08', operator: '陆师傅', state: '已完成' }
];

const ENVIRONMENTS: Array<Omit<EnvironmentRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'en-001', pianoId: 'pn-001', date: '2024-04-08', tempC: 22.4, humidityPct: 52, device: '温湿度计', abnormal: false },
  { id: 'en-002', pianoId: 'pn-002', date: '2024-04-10', tempC: 27.8, humidityPct: 68, device: '记录仪', abnormal: true },
  { id: 'en-003', pianoId: 'pn-003', date: '2024-04-12', tempC: 16.5, humidityPct: 35, device: '温湿度计', abnormal: true }
];

const REMINDERS: Array<Omit<ReminderRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'rm-001', pianoId: 'pn-001', cycleMonths: 6, lastTuningDate: '2024-04-08', nextDueDate: '2024-10-08', state: '正常' },
  { id: 'rm-002', pianoId: 'pn-002', cycleMonths: 6, lastTuningDate: '2024-03-20', nextDueDate: '2024-09-20', state: '临近' },
  { id: 'rm-003', pianoId: 'pn-003', cycleMonths: 12, lastTuningDate: '2023-11-02', nextDueDate: '2024-11-02', state: '超期' }
];

/** 灌入演示数据（钢琴 → 调律 → 维修 / 环境 → 提醒） */
export async function seedDatabase(): Promise<void> {
  await db.transaction('rw', [db.pianos, db.tunings, db.voicings, db.environments, db.reminders], async () => {
    await db.pianos.bulkPut(PIANOS.map(rev));
    await db.tunings.bulkPut(TUNINGS.map(rev));
    await db.voicings.bulkPut(VOICINGS.map(rev));
    await db.environments.bulkPut(ENVIRONMENTS.map(rev));
    await db.reminders.bulkPut(REMINDERS.map(rev));
  });
}
