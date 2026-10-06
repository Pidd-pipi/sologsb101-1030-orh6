/**
 * 筛选条件 ↔ URL query 的互转工具
 * FilterBar 的筛选状态同步到地址栏，刷新后仍可复现同一视图。
 */
import type { FilterModel } from '$lib/types/filter';

/** 把筛选条件序列化为 query 对象（空值不下发） */
export function filtersToQuery(filters: FilterModel): Record<string, string> {
  const query: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) query[key] = value.join(',');
    } else if (typeof value === 'string') {
      if (value.length > 0) query[key] = value;
    } else if (typeof value === 'boolean') {
      if (value) query[key] = '1';
    }
  });
  return query;
}

/** 把 query 对象还原为筛选条件 */
export function queryToFilters(
  query: Record<string, string | string[] | undefined>,
  keys: string[]
): FilterModel {
  const filters: FilterModel = { keyword: '' };
  keys.forEach((key) => {
    const raw = query[key];
    if (raw === '1') {
      // 布尔开关（如「仅看超标记录」）在 query 里以 1 表示
      filters[key] = true;
    } else if (typeof raw === 'string' && raw.length > 0) {
      filters[key] = raw.split(',').filter((item) => item.length > 0);
    } else {
      filters[key] = [];
    }
  });
  if (typeof query.keyword === 'string') filters.keyword = query.keyword;
  return filters;
}

/** 把筛选条件拼成 query string（供 $lib/router 的 push 使用） */
export function toQueryString(filters: FilterModel): string {
  const params = new URLSearchParams(filtersToQuery(filters));
  const text = params.toString();
  return text.length > 0 ? `?${text}` : '';
}
