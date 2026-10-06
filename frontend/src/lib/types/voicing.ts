/** 维修类型 */
export type VoicingType = '整音' | '换弦' | '击弦机调整' | '踏板调整';
/** 部件 */
export type VoicingPart = '毡槌' | '琴弦' | '联动杆' | '呢毡';
/** 维修状态 */
export type VoicingState = '计划' | '已完成';

/** 整音与维修记录 */
export interface Voicing {
  id: string;
  /** 所属钢琴 */
  pianoId: string;
  /** 维修类型 */
  type: VoicingType;
  /** 部件 */
  parts: VoicingPart;
  /** 材料与规格 */
  material: string;
  /** 日期 */
  date: string;
  /** 操作人 */
  operator: string;
  /** 状态 */
  state: VoicingState;
}

export const VOICING_TYPES: VoicingType[] = ['整音', '换弦', '击弦机调整', '踏板调整'];
export const VOICING_PARTS: VoicingPart[] = ['毡槌', '琴弦', '联动杆', '呢毡'];
export const VOICING_STATES: VoicingState[] = ['计划', '已完成'];

export function createEmptyVoicing(): Omit<Voicing, 'id'> {
  return {
    pianoId: '',
    type: '整音',
    parts: '毡槌',
    material: '',
    date: new Date().toISOString().slice(0, 10),
    operator: '',
    state: '计划'
  };
}
