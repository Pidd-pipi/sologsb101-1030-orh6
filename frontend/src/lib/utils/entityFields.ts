/**
 * 各实体参与字段级合并的业务字段清单。
 * id / revision / createdAt / updatedAt 为系统字段，不参与冲突判定。
 * 新增业务字段时在此登记，合并与待确认逻辑即可自动覆盖。
 */
import type { EntityTable } from './syncBus';

export const ENTITY_FIELDS: Record<EntityTable, string[]> = {
  pianos: ['brand', 'model', 'serialNo', 'type', 'venue', 'purchaseYear', 'state'],
  tunings: [
    'pianoId',
    'date',
    'basePitchHz',
    'avgDeviationCents',
    'maxDeviationCents',
    'zones',
    'technician',
    'pitchRaised',
    'source'
  ],
  voicings: ['pianoId', 'type', 'parts', 'material', 'date', 'operator', 'state', 'source'],
  environments: ['pianoId', 'date', 'tempC', 'humidityPct', 'device', 'abnormal'],
  reminders: ['pianoId', 'cycleMonths', 'lastTuningDate', 'nextDueDate', 'state']
};

/** 实体表中文名（待确认中心展示） */
export const ENTITY_LABELS: Record<EntityTable, string> = {
  pianos: '钢琴档案',
  tunings: '调律记录',
  voicings: '整音与维修',
  environments: '琴房环境',
  reminders: '周期提醒'
};

/** 取记录所属钢琴 id（pianos 表用自身 id） */
export function pianoIdOf(table: EntityTable, row: Record<string, unknown>): string {
  if (table === 'pianos') return String(row.id ?? '');
  return String(row.pianoId ?? '');
}
