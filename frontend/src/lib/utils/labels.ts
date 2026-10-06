/**
 * 待确认操作的中文展示标签：表名、字段名、值的格式化。
 * 冲突中心用它把 'tunings' / 'avgDeviationCents' 这类内部键显示成中文。
 */
import type { ConflictTable } from '$lib/types/conflict';
import { ZONE_LABELS } from '$lib/types/tuning';
import { SOURCE_FIELD } from '$lib/types/conflict';

export const TABLE_LABELS: Record<ConflictTable, string> = {
  pianos: '钢琴档案',
  tunings: '调律记录',
  voicings: '整音与维修',
  environments: '琴房环境',
  reminders: '周期提醒'
};

const FIELD_LABELS: Record<ConflictTable, Record<string, string>> = {
  pianos: {
    brand: '品牌',
    model: '型号',
    serialNo: '序列号',
    type: '类型',
    venue: '使用场所',
    purchaseYear: '购入年份',
    state: '状态'
  },
  tunings: {
    pianoId: '钢琴',
    date: '调律日期',
    basePitchHz: '基准音高',
    avgDeviationCents: '平均偏差',
    maxDeviationCents: '最大偏差',
    zones: '音区偏差',
    technician: '调律师',
    pitchRaised: '需复调'
  },
  voicings: {
    pianoId: '钢琴',
    type: '维修类型',
    parts: '部件',
    material: '材料与规格',
    date: '日期',
    operator: '操作人',
    state: '状态'
  },
  environments: {
    pianoId: '钢琴',
    date: '日期',
    tempC: '温度',
    humidityPct: '湿度',
    device: '监测方式',
    abnormal: '是否超标'
  },
  reminders: {
    pianoId: '钢琴',
    cycleMonths: '建议周期',
    lastTuningDate: '上次调律日期',
    nextDueDate: '下次建议日期',
    state: '周期状态'
  }
};

export function fieldLabel(table: ConflictTable, field: string): string {
  if (field === SOURCE_FIELD) return '数据来源';
  if (field === 'zones.bass' || field === 'zones.mid' || field === 'zones.treble') {
    const key = field.split('.')[1] as 'bass' | 'mid' | 'treble';
    return `音区偏差·${ZONE_LABELS.find((z) => z.key === key)?.label ?? key}`;
  }
  return FIELD_LABELS[table]?.[field] ?? field;
}

/** 把任意字段值格式化为短文本 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') {
    const zones = value as { bass?: number; mid?: number; treble?: number };
    if ('bass' in zones || 'mid' in zones || 'treble' in zones) {
      return `低 ${zones.bass ?? 0} / 中 ${zones.mid ?? 0} / 高 ${zones.treble ?? 0}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}
